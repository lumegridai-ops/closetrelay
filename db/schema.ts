import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('closet_workspaces',{
  scope:text('scope').primaryKey(),revision:integer('revision').notNull(),objectKey:text('object_key').notNull(),updatedAt:integer('updated_at').notNull(),
});
export const samplePreview=sqliteTable('closet_sample_preview',{
  id:text('id').primaryKey(),status:text('status').notNull(),sourceHash:text('source_hash').notNull(),referenceHash:text('reference_hash').notNull(),
  taskId:text('task_id'),resultKey:text('result_key'),resultHash:text('result_hash'),errorCode:text('error_code'),
  createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),nextPollAt:integer('next_poll_at').notNull(),
});
