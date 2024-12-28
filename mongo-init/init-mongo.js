db = db.getSiblingDB('healthcareDB');

db.createUser({
  user: process.env.MONGO_INITDB_ROOT_USERNAME,
  pwd: process.env.MONGO_INITDB_ROOT_PASSWORD,
  roles: [
    {
      role: "readWrite",
      db: "healthcareDB"
    }
  ]
});

// Insert initial data to trigger database creation
db.links.insertOne({
  url: "https://example.com",
  description: "Initial link",
  tags: ["example"],
  createdAt: new Date()
});
