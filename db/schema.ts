import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
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

// Stable Google subject binding prevents reassigned email addresses taking over trips.
export const authIdentities = sqliteTable('auth_identities', {
 googleSub: text('google_sub').primaryKey(),
 email: text('email').notNull().unique(),
 createdAt: integer('created_at').notNull()
});
export const authLoginChallenges = sqliteTable('auth_login_challenges', {
 tokenHash: text('token_hash').primaryKey(),
 nonceHash: text('nonce_hash').notNull(),
 returnTo: text('return_to').notNull(),
 createdAt: integer('created_at').notNull(),
 expiresAt: integer('expires_at').notNull()
},table=>[index('auth_login_challenges_expiry').on(table.expiresAt)]);
export const authSessions = sqliteTable('auth_sessions', {
 tokenHash: text('token_hash').primaryKey(),
 email: text('email').notNull(),
 googleSub: text('google_sub').notNull(),
 createdAt: integer('created_at').notNull(),
 expiresAt: integer('expires_at').notNull()
},table=>[index('auth_sessions_expiry').on(table.expiresAt),index('auth_sessions_subject_created').on(table.googleSub,table.createdAt)]);

export const placeGeocodeCache = sqliteTable('place_geocode_cache', {
 queryHash: text('query_hash').primaryKey().notNull(),
 result: text('result').notNull(),
 expiresAt: integer('expires_at').notNull(),
 updatedAt: integer('updated_at').notNull()
},table=>[index('place_geocode_cache_expiry').on(table.expiresAt)]);
export const placeGeocodeRate = sqliteTable('place_geocode_rate', {
 id: integer('id').primaryKey().notNull(),
 day: integer('day').notNull(),
 requests: integer('requests').notNull(),
 nextRequestAt: integer('next_request_at').notNull()
});
export const deletedItineraries = sqliteTable('deleted_itineraries', {
 id: text('id').primaryKey().notNull(),
 ownerEmail: text('owner_email').notNull(),
 revision: integer('revision').notNull()
});
export const deletedStops = sqliteTable('deleted_stops', {
 tripId: text('trip_id').notNull().references(()=>itineraries.id),
 stopId: text('stop_id').notNull()
},table=>[primaryKey({columns:[table.tripId,table.stopId]})]);
