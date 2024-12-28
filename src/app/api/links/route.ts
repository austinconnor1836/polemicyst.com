import { getErrorMessage } from '@/lib/error';
import { connectToDatabase, Link } from '@/lib/mongodb';
import { NextResponse } from 'next/server';

// GET - Fetch all links
export async function GET() {
  try {
    await connectToDatabase();
    const links = await Link.find({});
    return NextResponse.json(links);
  } catch (error) {
    console.error('Error fetching links:', error);
    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to fetch links' },
      { status: 500 }
    );
  }
}

// POST - Create a new link
export async function POST(req: Request) {
  try {
    const { url, description, tags } = await req.json();
    if (!url || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Additional URL validation (simple regex)
    const urlRegex = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i;
    if (!urlRegex.test(url)) {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const newLink = new Link({ url, description, tags });
    await newLink.save();

    return NextResponse.json(newLink, { status: 201 });
  } catch (error) {
    console.error('Error creating link:', error);

    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to create link' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a link by ID
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    await connectToDatabase();
    console.log('id', id);

    const deletedLink = await Link.findByIdAndDelete(id);
    console.log('deletedLink', deletedLink);
    if (!deletedLink) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    return NextResponse.json(deletedLink, { status: 200 });
  } catch (error) {
    console.error('Error deleting link:', error);

    return NextResponse.json(
      { error: error.message || 'Failed to delete link' },
      { status: 500 }
    );
  }
}

// Other functions (GET, POST, etc.) remain unchanged