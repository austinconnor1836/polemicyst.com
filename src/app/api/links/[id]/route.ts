import { connectToDatabase, Link } from '@/lib/mongodb';
import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error';

// GET - Fetch a single link by ID
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    await connectToDatabase();

    const link = await Link.findById(slug);
    if (!link) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    return NextResponse.json(link);
  } catch (error) {
    console.error('Error fetching link:', error);

    return NextResponse.json(
      { error: getErrorMessage(error) || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// PUT - Update a link by ID
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { url, description, tags } = await req.json();

    await connectToDatabase();

    const updatedLink = await Link.findByIdAndUpdate(
      slug,
      { url, description, tags },
      { new: true, runValidators: true }
    );

    if (!updatedLink) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    return NextResponse.json(updatedLink);
  } catch (error) {
    console.error('Error updating link:', error);

    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to update link' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a link by ID
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    await connectToDatabase();
    console.log('slug', slug);

    const deletedLink = await Link.findByIdAndDelete(slug);
    console.log('deletedLink', deletedLink);
    if (!deletedLink) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    return NextResponse.json(
      deletedLink,
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting link:', error);

    return NextResponse.json(
      { error: getErrorMessage(error) || 'Failed to delete link' },
      { status: 500 }
    );
  }
}
