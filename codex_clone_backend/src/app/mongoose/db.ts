// getting-started.js
const mongoose = require("mongoose");

export async function dbConnection() {
  await mongoose
    .connect(process.env.DB_URL as string)
    .then(() => console.log("Connected"))
    .catch((err: Error) => console.error("DB connection error", err));

  // use `await mongoose.connect('mongodb://user:password@127.0.0.1:27017/test');` if your database has auth enabled
}
