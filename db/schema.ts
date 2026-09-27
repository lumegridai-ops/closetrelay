import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const workspaces=sqliteTable('closet_workspaces',{
  scope:text('scope').primaryKey(),revision:integer('revision').notNull(),objectKey:text('object_key').notNull(),updatedAt:integer('updated_at').notNull(),
});
