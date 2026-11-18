import { MongoClient, type Db } from 'mongodb';

const globalMongo = globalThis as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

function getClientPromise() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required. Add it to .env.local.');
  if (!globalMongo._mongoClientPromise) {
    globalMongo._mongoClientPromise = new MongoClient(uri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 10_000,
    }).connect();
  }
  return globalMongo._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB_NAME || 'stock_management_os');
}

export async function closeMongoConnection() {
  if (!globalMongo._mongoClientPromise) return;
  const client = await globalMongo._mongoClientPromise;
  await client.close();
  delete globalMongo._mongoClientPromise;
}
