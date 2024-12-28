import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import mongoose from 'mongoose';

// Define schema
const linkSchema = new mongoose.Schema({
  url: {
    type: String,
    required: [true, 'URL is required'],
    unique: true,
    trim: true,
    match: [
      /^(https?:\/\/)?([\w\d\-]+\.)+[\w]{2,}(\/[^\s]*)?$/,
      'Please enter a valid URL',
    ],
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [300, 'Description cannot exceed 300 characters'],
  },
  tags: {
    type: [String],
    required: [true, 'At least one tag is required'],
    validate: {
      validator: (v: string[]) => v.length <= 5,
      message: 'You can only add up to 5 tags',
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Link = mongoose.models.Link || mongoose.model('Link', linkSchema);

// Handle POST requests to submit a link
export async function POST(req: NextRequest) {
  await connectToDatabase();

  const body = await req.json();
  const { url, description, tags } = body;

  // Basic server-side validation
  if (!url || !description || !tags) {
    return NextResponse.json(
      { error: 'All fields are required' },
      { status: 400 }
    );
  }

  if (tags.length > 5) {
    return NextResponse.json(
      { error: 'Maximum of 5 tags allowed' },
      { status: 400 }
    );
  }

  if (description.length > 300) {
    return NextResponse.json(
      { error: 'Description cannot exceed 300 characters' },
      { status: 400 }
    );
  }

  try {
    // Check for existing URL to prevent duplicates
    const existingLink = await Link.findOne({ url });
    if (existingLink) {
      return NextResponse.json(
        { error: 'This link has already been submitted' },
        { status: 409 }
      );
    }

    // Save new link
    const newLink = new Link({ url, description, tags });
    await newLink.save();

    return NextResponse.json(
      { message: 'Link submitted successfully', link: newLink },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error submitting link:', error);

    if (error instanceof mongoose.Error.ValidationError) {
      const errors = Object.values(error.errors).map((err) => err.message);
      return NextResponse.json(
        { error: errors.join(', ') },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
