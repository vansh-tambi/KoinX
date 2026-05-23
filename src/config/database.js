import mongoose from 'mongoose';

export const connectDb = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not defined in environment');
  }
  await mongoose.connect(uri, {
    // mongoose 7+ default options handle deprecations
  });
  console.log('MongoDB connected');
};
