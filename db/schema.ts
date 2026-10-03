import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const trips = sqliteTable('trips', {
 userId: text('user_id').primaryKey(),
 payload: text('payload').notNull(),
 previous: text('previous'),
 revision: integer('revision').notNull().default(1),
 mutationId: text('mutation_id').notNull(),
 updatedAt: text('updated_at').notNull()
});
export const tripMembers = sqliteTable('trip_members', {
 email: text('email').primaryKey(),
 role: text('role').notNull(),
 enabled: integer('enabled').notNull().default(1),
 updatedAt: text('updated_at').notNull()
});
// The legacy tables above remain as a recovery snapshot after migration.
export const itineraries = sqliteTable('itineraries', {
 id: text('id').primaryKey(),
 ownerEmail: text('owner_email').notNull(),
 title: text('title').notNull(),
 startDate: text('start_date').notNull(),
 endDate: text('end_date').notNull(),
 timezone: text('timezone').notNull().default('Asia/Taipei'),
 payload: text('payload').notNull(),
 previous: text('previous'),
 revision: integer('revision').notNull().default(0),
 mutationId: text('mutation_id').notNull().default(''),
 createdAt: text('created_at').notNull(),
 updatedAt: text('updated_at').notNull(),
 deletedAt: text('deleted_at')
});
export const itineraryMembers = sqliteTable('itinerary_members', {
 tripId: text('trip_id').notNull().references(()=>itineraries.id),
 email: text('email').notNull(),
 role: text('role').notNull(),
 enabled: integer('enabled').notNull().default(1),
 updatedAt: text('updated_at').notNull()
},table=>[primaryKey({columns:[table.tripId,table.email]})]);
export const appMigrations = sqliteTable('app_migrations', {
 name: text('name').primaryKey()
});
export const stopCreators = sqliteTable('stop_creators', {
 tripId: text('trip_id').notNull().references(()=>itineraries.id),
 stopId: text('stop_id').notNull(),
 createdBy: text('created_by')
},table=>[primaryKey({columns:[table.tripId,table.stopId]})]);
