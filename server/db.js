import mongoose from 'mongoose'

export async function connectDatabase(uri) {
  mongoose.set('strictQuery', true)

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  })

  console.log(`[orchion] MongoDB connected (${mongoose.connection.name})`)
  return mongoose.connection
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}
