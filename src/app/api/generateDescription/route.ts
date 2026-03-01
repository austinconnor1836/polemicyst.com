// /src/app/api/generateDescription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { generateMetadataWithOllama } from '@shared/lib/metadata-generation';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { videoId } = await req.json();

  if (!videoId) {
    return new Response('Missing videoId', { status: 400 });
  }

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: {
        userId: true,
        transcript: true,
        user: {
          select: {
            templatePreferences: {
              select: {
                sharedPostscript: true,
              },
            },
          },
        },
      },
    });

    if (!video || !video.transcript) {
      return new Response('Transcript not found for video', { status: 404 });
    }

    if (video.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ✅ Generate metadata using shared logic
    const { title, description } = await generateMetadataWithOllama(video.transcript);

    const fixedHashtags = [
      '#Polemicyst',
      '#news',
      '#politics',
      '#youtube',
      '#trump',
      '#left',
      '#progressive',
      '#viral',
      '#maga',
    ];
    const allHashtags = [...fixedHashtags];
    const hashtagsString = allHashtags.join(', ');

    const postscript = video.user?.templatePreferences?.sharedPostscript ?? '';
    const patreonLink = '\n\nSupport me on Patreon: https://www.patreon.com/c/Polemicyst';
    const fullDescription = `${description}\n\n${hashtagsString}\n${postscript}${patreonLink}`;
    const shortTemplate = `${description} ${hashtagsString}`.substring(0, 300).trim();

    // 4. Update the video with the generated data
    const updated = await prisma.video.update({
      where: { id: videoId },
      data: {
        videoTitle: title || 'Generated title',
        sharedDescription: fullDescription,
        blueskyTemplate: shortTemplate,
        twitterTemplate: shortTemplate,
      },
    });

    return Response.json(updated);
  } catch (err) {
    console.error('Error generating description:', err);
    return new Response('Failed to generate description', { status: 500 });
  }
}
