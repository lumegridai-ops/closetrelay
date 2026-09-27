"""Run the unchanged local workflow in a browser, with no provider or uploads."""
import json, sys, sqlite3
sys.path.insert(0, '/app')
from backend.server import Application, APIError
from backend.model import Conflict, Denied, NotFound
app = None

def close_workspace():
    global app
    app = None

def open_workspace():
    global app
    app = Application('/session/closet.sqlite3')

def checkpoint_workspace():
    with sqlite3.connect('/session/closet.sqlite3') as connection:
        connection.execute('PRAGMA wal_checkpoint(TRUNCATE)')

def dispatch_request(encoded):
    request = json.loads(encoded)
    path, method, body = request['path'], request['method'], request.get('body')
    try:
        if path in ('/api/uploads', '/api/provider/configure'):
            raise APIError(503, 'demo_only', 'Photo uploads and provider keys are disabled in this fictional hosted demo. Use the local application for the full provider setup.')
        status, result = app.dispatch(method, path, body)
        if path == '/api/state':
            result['scope']['mode'] = 'hosted_demo'
            result['scope']['notice'] = 'Your isolated fictional demonstration workspace. Roles are workflow steps, not separate authenticated staff or clients.'
            result['provider']['reason'] = 'YouCam is disabled in this hosted demo. No generated preview or live API result is claimed.'
        return json.dumps({'status':status, 'body':result})
    except APIError as error:
        return json.dumps({'status':error.status, 'body':error.body()})
    except NotFound as error:
        return json.dumps({'status':404, 'body':{'error':{'code':'not_found','message':str(error)}}})
    except Conflict as error:
        return json.dumps({'status':409, 'body':{'error':{'code':'state_conflict','message':str(error)}}})
    except Denied as error:
        return json.dumps({'status':403, 'body':{'error':{'code':'action_denied','message':str(error)}}})
    except sqlite3.IntegrityError:
        return json.dumps({'status':409, 'body':{'error':{'code':'record_conflict','message':'This identifier or allocation already exists.'}}})
