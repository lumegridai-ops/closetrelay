"""Persistent local workflow, adapted from the independently tested experiment.

The HTTP application supplies trusted local-operator contexts. This module does
not authenticate users. Real provider completion is internal to the server.
Original experiment source SHA256: da5fbd0fd880b503a40498c396a885069dfb89c9ade94b3744495c1453e501a0.
"""
from contextlib import contextmanager
from dataclasses import dataclass
import json
import sqlite3
import uuid
from datetime import datetime, timezone
import hashlib


class Conflict(Exception):
    pass


class Denied(Exception):
    pass


class NotFound(Conflict):
    pass


@dataclass(frozen=True)
class Actor:
    # Trusted authentication context for this experiment; not a login mechanism.
    role: str
    appointment_id: str | None = None
    assignments: tuple[str, ...] = ()


MAX_ATTEMPTS = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS appointments (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, current_approval TEXT,
 choice_revision INTEGER NOT NULL DEFAULT 0, consent INTEGER NOT NULL DEFAULT 0,
 consent_revision INTEGER NOT NULL DEFAULT 0, source_revision INTEGER NOT NULL DEFAULT 0,
 source_ref TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, photo_ref TEXT NOT NULL,
 location TEXT NOT NULL, condition TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL DEFAULT 'available' CHECK(state IN ('available','held','packed','unavailable')),
 owner TEXT REFERENCES appointments(id), is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS approvals (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
 item_id TEXT NOT NULL REFERENCES items(id), item_version INTEGER NOT NULL,
 choice_revision INTEGER NOT NULL, state TEXT NOT NULL,
 item_snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holds (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
 item_id TEXT NOT NULL REFERENCES items(id), approval_id TEXT NOT NULL UNIQUE REFERENCES approvals(id),
 item_version INTEGER NOT NULL, state TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_item_hold ON holds(item_id) WHERE state='active';
CREATE TABLE IF NOT EXISTS handoffs (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
 item_id TEXT NOT NULL UNIQUE REFERENCES items(id), approval_id TEXT NOT NULL UNIQUE REFERENCES approvals(id),
 hold_id TEXT NOT NULL UNIQUE REFERENCES holds(id), item_version INTEGER NOT NULL,
 request_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS previews (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
 approval_id TEXT NOT NULL REFERENCES approvals(id), item_id TEXT NOT NULL REFERENCES items(id),
 item_version INTEGER NOT NULL, item_photo_ref TEXT NOT NULL, choice_revision INTEGER NOT NULL,
 consent_revision INTEGER NOT NULL, source_revision INTEGER NOT NULL, source_ref TEXT,
 chain_id TEXT NOT NULL, attempt INTEGER NOT NULL, status TEXT NOT NULL,
 result_ref TEXT, reason TEXT, UNIQUE(chain_id,attempt)
);
CREATE TABLE IF NOT EXISTS audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, target TEXT NOT NULL,
 payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_jobs (
 preview_id TEXT PRIMARY KEY REFERENCES previews(id), provider TEXT NOT NULL,
 provider_task_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, error TEXT, task_json TEXT
);
CREATE TABLE IF NOT EXISTS media (
 id TEXT PRIMARY KEY, purpose TEXT NOT NULL, appointment_id TEXT REFERENCES appointments(id),
 mime_type TEXT NOT NULL, sha256 TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
);
"""


class Closet:
    def __init__(self, database):
        self.database = str(database)
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(SCHEMA)

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(self.database, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def _transaction(self):
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    @staticmethod
    def _row(connection, table, identifier):
        # Only callers inside this module supply table names.
        row = connection.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise NotFound("Unknown record")
        return dict(row)

    @staticmethod
    def _audit(connection, kind, target, **data):
        # Never retain personal source/output reference tokens in the audit log.
        connection.execute("INSERT INTO audit(kind,target,payload) VALUES(?,?,?)",
                           (kind, target, json.dumps(data, sort_keys=True)))

    @staticmethod
    def _access(actor, appointment_id, roles):
        allowed = actor.role in roles and (
            (actor.role == "client" and actor.appointment_id == appointment_id)
            or (actor.role == "stylist" and appointment_id in actor.assignments)
            or actor.role == "picker"
        )
        if not allowed:
            raise Denied("This role cannot access this appointment's information or action")

    def seed(self, fixture):
        with self._transaction() as connection:
            for appointment in fixture["appointments"]:
                connection.execute("INSERT INTO appointments(id,name,is_demo) VALUES(?,?,?)",
                                   (appointment["id"], appointment["name"], int(appointment.get("is_demo", False))))
            for item in fixture["items"]:
                connection.execute("INSERT INTO items(id,label,photo_ref,location,condition,is_demo) VALUES(?,?,?,?,?,?)",
                                   (item["id"], item["label"], item.get("photo_ref") or "", item["location"],
                                    item["condition"], int(item.get("is_demo", False))))

    def initialize_demo(self, fixture):
        """Seed one clearly fictional catalog on first startup; never reset it."""
        with self._transaction() as connection:
            if connection.execute("SELECT 1 FROM settings WHERE key='initialized'").fetchone():
                return
            if not connection.execute("SELECT 1 FROM appointments LIMIT 1").fetchone() and not connection.execute("SELECT 1 FROM items LIMIT 1").fetchone():
                for appointment in fixture["appointments"]:
                    connection.execute("INSERT INTO appointments(id,name,is_demo) VALUES(?,?,1)",
                                       (appointment["id"], appointment["name"]))
                for item in fixture["items"]:
                    connection.execute("INSERT INTO items(id,label,photo_ref,location,condition,is_demo) VALUES(?,?, '',?,?,1)",
                                       (item["id"], item["label"], item["location"], item["condition"]))
            connection.execute("INSERT INTO settings VALUES('initialized','1')")

    def create_appointment(self, name, identifier=None):
        identifier = identifier or str(uuid.uuid4())
        with self._transaction() as connection:
            connection.execute("INSERT INTO appointments(id,name) VALUES(?,?)", (identifier, name))
            self._audit(connection, "appointment_created", identifier)
        return self.appointment(Actor("client", identifier), identifier)

    def create_item(self, identifier, label, location, condition):
        with self._transaction() as connection:
            connection.execute("INSERT INTO items(id,label,photo_ref,location,condition) VALUES(?,?, '',?,?)",
                               (identifier, label, location, condition))
            self._audit(connection, "item_created", identifier)
            return self._row(connection, "items", identifier)

    def items(self):
        with self._connection() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM items ORDER BY id")]

    def appointments(self):
        with self._connection() as connection:
            identifiers = [row["id"] for row in connection.execute("SELECT id FROM appointments ORDER BY name,id")]
        return [self.appointment(Actor("client", identifier), identifier) for identifier in identifiers]

    @staticmethod
    def _release(connection, hold, state):
        connection.execute("UPDATE holds SET state=? WHERE id=? AND state='active'", (state, hold["id"]))
        connection.execute("UPDATE items SET state='available',owner=NULL WHERE id=? AND state='held' AND owner=?",
                           (hold["item_id"], hold["appointment_id"]))

    def choose(self, actor, item_id, expected_version, expected_choice_revision=None):
        appointment_id = actor.appointment_id
        self._access(actor, appointment_id, {"client"})
        with self._transaction() as connection:
            appointment = self._row(connection, "appointments", appointment_id)
            if expected_choice_revision is not None and appointment["choice_revision"] != expected_choice_revision:
                raise Conflict("The appointment choice changed; reload and review the current choice")
            item = self._row(connection, "items", item_id)
            if item["version"] != expected_version:
                raise Conflict("The item changed; review its current card")
            if item["state"] != "available" and not (item["state"] == "held" and item["owner"] == appointment_id):
                raise Conflict("Item is unavailable; choose again when an available item is offered")
            if appointment["current_approval"]:
                previous = self._row(connection, "approvals", appointment["current_approval"])
                if previous["state"] == "fulfilled":
                    raise Conflict("This one-item experiment appointment is already fulfilled")
                for hold in connection.execute("SELECT * FROM holds WHERE appointment_id=? AND state='active'", (appointment_id,)):
                    self._release(connection, hold, "released")
                connection.execute("UPDATE approvals SET state='superseded' WHERE id=?", (previous["id"],))
            identifier = str(uuid.uuid4())
            revision = appointment["choice_revision"] + 1
            connection.execute("INSERT INTO approvals VALUES(?,?,?,?,?,?,?)", (
                identifier, appointment_id, item_id, expected_version, revision, "active", json.dumps(item, sort_keys=True)))
            connection.execute("UPDATE appointments SET current_approval=?,choice_revision=? WHERE id=?",
                               (identifier, revision, appointment_id))
            self._audit(connection, "client_approved", appointment_id, approval_id=identifier,
                        item_id=item_id, item_version=expected_version, choice_revision=revision)
            return self._row(connection, "approvals", identifier)

    def hold(self, actor, appointment_id, approval_id):
        self._access(actor, appointment_id, {"stylist"})
        with self._transaction() as connection:
            appointment = self._row(connection, "appointments", appointment_id)
            approval = self._row(connection, "approvals", approval_id)
            if approval["appointment_id"] != appointment_id or appointment["current_approval"] != approval_id or approval["state"] != "active":
                raise Conflict("Approval is no longer current; client review is required")
            item = self._row(connection, "items", approval["item_id"])
            if item["version"] != approval["item_version"]:
                raise Conflict("Item changed after approval; client review is required")
            existing = connection.execute("SELECT * FROM holds WHERE approval_id=? AND state='active'", (approval_id,)).fetchone()
            if existing:
                return dict(existing)
            if item["state"] != "available":
                raise Conflict("Item is held or unavailable; no hold was created for this appointment")
            identifier = str(uuid.uuid4())
            connection.execute("INSERT INTO holds VALUES(?,?,?,?,?,?)", (
                identifier, appointment_id, item["id"], approval_id, item["version"], "active",))
            connection.execute("UPDATE items SET state='held',owner=? WHERE id=?", (appointment_id, item["id"]))
            self._audit(connection, "item_held", appointment_id, item_id=item["id"], hold_id=identifier, approval_id=approval_id)
            return self._row(connection, "holds", identifier)

    def release(self, actor, hold_id):
        with self._transaction() as connection:
            hold = self._row(connection, "holds", hold_id)
            self._access(actor, hold["appointment_id"], {"stylist"})
            if hold["state"] == "released":
                return
            if hold["state"] != "active":
                raise Conflict("Only an active hold can be released")
            self._release(connection, hold, "released")
            connection.execute("UPDATE approvals SET state='released' WHERE id=?", (hold["approval_id"],))
            self._audit(connection, "hold_released", hold["appointment_id"], hold_id=hold_id, approval_id=hold["approval_id"])

    def edit_item(self, actor, item_id, *, photo_ref=None, condition=None, unavailable=None, expected_version=None):
        if actor.role != "stylist":
            raise Denied("Only inventory staff can edit item cards")
        with self._transaction() as connection:
            item = self._row(connection, "items", item_id)
            if expected_version is not None and item["version"] != expected_version:
                raise Conflict("The item changed; reload its current card before editing")
            if item["state"] == "packed":
                raise Conflict("Packed inventory cannot be edited in this experiment")
            for hold in connection.execute("SELECT * FROM holds WHERE item_id=? AND state='active'", (item_id,)):
                self._release(connection, hold, "invalidated")
            connection.execute("UPDATE approvals SET state='needs_review' WHERE item_id=? AND state='active'", (item_id,))
            connection.execute("UPDATE items SET version=version+1,photo_ref=?,condition=?,state=?,owner=NULL WHERE id=?",
                               (photo_ref if photo_ref is not None else item["photo_ref"],
                                condition if condition is not None else item["condition"],
                                "unavailable" if (item["state"] == "unavailable" if unavailable is None else unavailable) else "available", item_id))
            self._audit(connection, "item_changed", item_id, old_version=item["version"], new_version=item["version"] + 1)
            return self._row(connection, "items", item_id)

    def consent(self, actor, source_ref=None):
        appointment_id = actor.appointment_id
        self._access(actor, appointment_id, {"client"})
        with self._transaction() as connection:
            self._row(connection, "appointments", appointment_id)
            if source_ref is not None:
                source = self._row(connection, "media", source_ref.removeprefix("/media/"))
                if source["purpose"] != "source" or source["appointment_id"] != appointment_id:
                    raise Conflict("The source photo does not belong to this appointment")
            connection.execute("UPDATE appointments SET consent=?,consent_revision=consent_revision+1,"
                               "source_revision=source_revision+1,source_ref=? WHERE id=?",
                               (int(source_ref is not None), source_ref, appointment_id))
            # Retired personal reference data is scrubbed, including pending tasks.
            connection.execute("UPDATE previews SET source_ref=NULL,result_ref=NULL,status='revoked',"
                               "reason='Consent or source photo changed' WHERE appointment_id=?", (appointment_id,))
            connection.execute("DELETE FROM media WHERE appointment_id=? AND id!=? AND purpose IN ('source','preview')",
                               (appointment_id, (source_ref or "").removeprefix("/media/")))
            connection.execute("UPDATE provider_jobs SET task_json=NULL,status='revoked_locally',"
                               "error='Local references removed; upstream retention/deletion unverified' "
                               "WHERE preview_id IN (SELECT id FROM previews WHERE appointment_id=?)", (appointment_id,))
            self._audit(connection, "consent_granted" if source_ref is not None else "consent_revoked", appointment_id)
            return {"consent": source_ref is not None}

    def request_preview(self, actor, *, retry_of=None):
        appointment_id = actor.appointment_id
        self._access(actor, appointment_id, {"client"})
        with self._transaction() as connection:
            appointment = self._row(connection, "appointments", appointment_id)
            if not appointment["consent"] or not appointment["source_ref"]:
                raise Denied("Photo consent is absent; use the original item card")
            if not appointment["current_approval"]:
                raise Conflict("Choose an item before requesting a preview")
            approval = self._row(connection, "approvals", appointment["current_approval"])
            item = self._row(connection, "items", approval["item_id"])
            if approval["state"] != "active" or item["version"] != approval["item_version"]:
                raise Conflict("The current item needs client review")
            if item["state"] != "available" and not (item["state"] == "held" and item["owner"] == appointment_id):
                raise Conflict("Item is unavailable; no preview was requested")
            identifier = str(uuid.uuid4())
            chain_id, attempt = identifier, 1
            if retry_of:
                prior = self._row(connection, "previews", retry_of)
                if prior["appointment_id"] != appointment_id:
                    raise Denied("Another appointment's task is private")
                if prior["status"] not in {"failed", "timed_out"} or prior["attempt"] >= MAX_ATTEMPTS:
                    raise Conflict("Retry limit reached or task is not retryable")
                if prior["approval_id"] != approval["id"] or prior["consent_revision"] != appointment["consent_revision"]:
                    raise Conflict("A changed choice or consent requires a new request")
                chain_id, attempt = prior["chain_id"], prior["attempt"] + 1
                if connection.execute("SELECT 1 FROM previews WHERE chain_id=? AND attempt=?", (chain_id, attempt)).fetchone():
                    raise Conflict("This retry was already created")
            connection.execute("INSERT INTO previews VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                identifier, appointment_id, approval["id"], item["id"], item["version"], item["photo_ref"],
                appointment["choice_revision"], appointment["consent_revision"], appointment["source_revision"],
                appointment["source_ref"], chain_id, attempt, "pending", None, None))
            self._audit(connection, "preview_requested", appointment_id, task_id=identifier, attempt=attempt)
            return {"id": identifier, "status": "pending", "attempt": attempt}

    def _preview_current(self, connection, task):
        appointment = self._row(connection, "appointments", task["appointment_id"])
        item = self._row(connection, "items", task["item_id"])
        approval = self._row(connection, "approvals", task["approval_id"])
        return bool(appointment["consent"] and appointment["consent_revision"] == task["consent_revision"]
                    and appointment["source_revision"] == task["source_revision"]
                    and appointment["current_approval"] == task["approval_id"]
                    and appointment["choice_revision"] == task["choice_revision"]
                    and approval["state"] == "active" and item["version"] == task["item_version"]
                    and item["photo_ref"] == task["item_photo_ref"]
                    and (item["state"] == "available" or (item["state"] == "held" and item["owner"] == task["appointment_id"])))

    def complete_preview(self, task_id, outcome, result_ref=None):
        if outcome not in {"succeeded", "failed", "timed_out"}:
            raise Conflict("Unsupported provider outcome")
        if outcome == "succeeded" and not result_ref:
            raise Conflict("A provider result reference is required")
        with self._transaction() as connection:
            task = self._row(connection, "previews", task_id)
            if task["status"] in {"revoked", "discarded"}:
                return {"status": task["status"], "displayable": False}
            if task["status"] != "pending":
                if task["status"] == outcome and (outcome != "succeeded" or task["result_ref"] == result_ref):
                    return {"status": task["status"], "displayable": task["status"] == "succeeded" and self._preview_current(connection, task)}
                raise Conflict("Conflicting terminal callback rejected")
            current = self._preview_current(connection, task)
            status = outcome if current else "discarded"
            connection.execute("UPDATE previews SET status=?,result_ref=?,reason=? WHERE id=?",
                               (status, result_ref if status == "succeeded" else None,
                                None if current else "Choice, consent, item version or availability changed", task_id))
            self._audit(connection, "preview_completed", task["appointment_id"], task_id=task_id, status=status)
            return {"status": status, "displayable": status == "succeeded"}

    def preview(self, actor, task_id):
        with self._connection() as connection:
            task = self._row(connection, "previews", task_id)
            self._access(actor, task["appointment_id"], {"client", "stylist"})
            displayable = task["status"] == "succeeded" and self._preview_current(connection, task)
            return {"id": task_id, "status": task["status"], "displayable": displayable,
                    "result_ref": task["result_ref"] if displayable else None}

    def appointment(self, actor, appointment_id):
        self._access(actor, appointment_id, {"client", "stylist"})
        with self._connection() as connection:
            appointment = self._row(connection, "appointments", appointment_id)
            approval = self._row(connection, "approvals", appointment["current_approval"]) if appointment["current_approval"] else None
            unresolved = None
            if approval:
                item = self._row(connection, "items", approval["item_id"])
                if approval["state"] not in {"active", "fulfilled"}:
                    unresolved = "Client review is required; the previous approval cannot allocate stock"
                elif item["state"] not in {"available", "packed"} and item["owner"] != appointment_id:
                    unresolved = "The selected item is held or unavailable; no hold exists for this appointment"
            active_holds = [dict(row) for row in connection.execute(
                "SELECT * FROM holds WHERE appointment_id=? AND state='active'", (appointment_id,))]
            handoffs = [dict(row) for row in connection.execute(
                "SELECT * FROM handoffs WHERE appointment_id=?", (appointment_id,))]
            return {"id": appointment_id, "name": appointment["name"], "approval": approval,
                    "current_approval": appointment["current_approval"], "choice_revision": appointment["choice_revision"],
                    "consent_revision": appointment["consent_revision"], "is_demo": bool(appointment["is_demo"]),
                    "active_holds": active_holds, "handoffs": handoffs,
                    "source_ref": appointment["source_ref"], "consent": bool(appointment["consent"]),
                    "unresolved_reason": unresolved}

    def picker_manifest(self, actor, appointment_id):
        self._access(actor, appointment_id, {"picker", "stylist"})
        with self._connection() as connection:
            return [dict(row) for row in connection.execute(
                "SELECT h.id AS hold_id,h.appointment_id,h.approval_id,h.item_id,h.item_version,"
                "i.label,i.photo_ref,i.location,i.condition FROM holds h JOIN items i ON h.item_id=i.id "
                "WHERE h.appointment_id=? AND h.state='active'", (appointment_id,))]

    def pick(self, actor, hold_id, actual_item_id, request_key):
        with self._transaction() as connection:
            hold = self._row(connection, "holds", hold_id)
            self._access(actor, hold["appointment_id"], {"picker"})
            if actual_item_id != hold["item_id"]:
                raise Conflict("Scanned item does not match the exact held and approved item")
            existing_key = connection.execute("SELECT * FROM handoffs WHERE request_key=?", (request_key,)).fetchone()
            if existing_key and existing_key["hold_id"] != hold_id:
                raise Conflict("Request key already belongs to another handoff")
            existing = connection.execute("SELECT * FROM handoffs WHERE hold_id=?", (hold_id,)).fetchone()
            if existing:
                return dict(existing)
            appointment = self._row(connection, "appointments", hold["appointment_id"])
            approval = self._row(connection, "approvals", hold["approval_id"])
            item = self._row(connection, "items", actual_item_id)
            if (hold["state"] != "active" or item["state"] != "held" or item["owner"] != hold["appointment_id"]
                or appointment["current_approval"] != hold["approval_id"] or approval["state"] != "active"
                or item["version"] != hold["item_version"] or item["version"] != approval["item_version"]):
                raise Conflict("Hold or approval changed; packing requires current client approval")
            identifier = str(uuid.uuid4())
            connection.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,?,?)", (
                identifier, hold["appointment_id"], actual_item_id, hold["approval_id"], hold_id, item["version"], request_key))
            connection.execute("UPDATE items SET state='packed' WHERE id=?", (actual_item_id,))
            connection.execute("UPDATE holds SET state='packed' WHERE id=?", (hold_id,))
            connection.execute("UPDATE approvals SET state='fulfilled' WHERE id=?", (hold["approval_id"],))
            self._audit(connection, "item_packed", hold["appointment_id"], item_id=actual_item_id, handoff_id=identifier,
                        approval_id=hold["approval_id"], hold_id=hold_id)
            return self._row(connection, "handoffs", identifier)

    def diagnostic_rows(self, table):
        """Test-only local database inspection; not exposed as an authorized product API."""
        if table not in {"appointments", "items", "approvals", "holds", "handoffs", "previews", "audit", "provider_jobs"}:
            raise ValueError("Unknown diagnostic table")
        with self._connection() as connection:
            return [dict(row) for row in connection.execute(f"SELECT * FROM {table}")]

    def upload_media(self, purpose, mime_type, data, appointment_id=None):
        identifier = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        with self._transaction() as connection:
            if appointment_id is not None:
                self._row(connection, "appointments", appointment_id)
            connection.execute("INSERT INTO media VALUES(?,?,?,?,?,?,?)",
                               (identifier, purpose, appointment_id, mime_type, hashlib.sha256(data).hexdigest(), data, created_at))
        return {"id": identifier, "url": f"/media/{identifier}", "purpose": purpose,
                "mime_type": mime_type, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}

    def media(self, identifier, for_display=False):
        with self._connection() as connection:
            record = self._row(connection, "media", identifier)
            if for_display and record["purpose"] == "preview":
                task = connection.execute("SELECT * FROM previews WHERE result_ref=?", (f"/media/{identifier}",)).fetchone()
                if task is None or not self._preview_current(connection, dict(task)):
                    raise NotFound("This preview is no longer current")
            return record

    def preview_record(self, identifier):
        with self._connection() as connection:
            return self._row(connection, "previews", identifier)

    def preview_current(self, identifier):
        with self._connection() as connection:
            return self._preview_current(connection, self._row(connection, "previews", identifier))

    def list_previews(self, appointment_id):
        with self._connection() as connection:
            return [row["id"] for row in connection.execute("SELECT id FROM previews WHERE appointment_id=? ORDER BY rowid DESC", (appointment_id,))]

    def record_provider_job(self, preview_id, *, task=None, status="requesting", error=None):
        """Persist actual task metadata; a late response cannot restore revoked refs."""
        now = datetime.now(timezone.utc).isoformat()
        with self._transaction() as connection:
            preview = self._row(connection, "previews", preview_id)
            existing = connection.execute("SELECT * FROM provider_jobs WHERE preview_id=?", (preview_id,)).fetchone()
            task_id = task.get("task_id") if task else (existing["provider_task_id"] if existing else None)
            if not self._preview_current(connection, preview):
                status = "revoked_locally" if preview["status"] == "revoked" else "stale"
                task = None
            task_json = json.dumps(task, sort_keys=True) if task is not None else None
            connection.execute("INSERT INTO provider_jobs VALUES(?,?,?,?,?,?,?,?) "
                               "ON CONFLICT(preview_id) DO UPDATE SET provider_task_id=excluded.provider_task_id,"
                               "status=excluded.status,updated_at=excluded.updated_at,error=excluded.error,task_json=excluded.task_json",
                               (preview_id, "youcam_clothes_v4", task_id, status, existing["created_at"] if existing else now,
                                now, json.dumps(error, sort_keys=True) if isinstance(error, dict) else error, task_json))

    def provider_job(self, preview_id):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM provider_jobs WHERE preview_id=?", (preview_id,)).fetchone()
            return dict(row) if row else None

    def complete_preview_image(self, preview_id, data, mime_type):
        """Only the real adapter supplies bytes. Recheck dependencies in the write transaction."""
        with self._transaction() as connection:
            task = self._row(connection, "previews", preview_id)
            if task["status"] == "succeeded":
                return {"status": "succeeded", "displayable": self._preview_current(connection, task)}
            if task["status"] != "pending" or not self._preview_current(connection, task):
                if task["status"] == "pending":
                    connection.execute("UPDATE previews SET status='discarded',result_ref=NULL,reason=? WHERE id=?",
                                       ("Choice, consent, item version or availability changed", preview_id))
                return {"status": "discarded" if task["status"] == "pending" else task["status"], "displayable": False}
            identifier = str(uuid.uuid4())
            connection.execute("INSERT INTO media VALUES(?,?,?,?,?,?,?)",
                               (identifier, "preview", task["appointment_id"], mime_type, hashlib.sha256(data).hexdigest(),
                                data, datetime.now(timezone.utc).isoformat()))
            connection.execute("UPDATE previews SET status='succeeded',result_ref=?,reason=NULL WHERE id=?",
                               (f"/media/{identifier}", preview_id))
            self._audit(connection, "preview_completed", task["appointment_id"], task_id=preview_id, status="succeeded")
            return {"status": "succeeded", "displayable": True}
