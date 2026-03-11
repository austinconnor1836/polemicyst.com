import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { rasterizeGraphic, getGraphicDimensions } from '@shared/lib/publishing/rasterize';
import { getS3Key } from '@shared/lib/s3';
import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const s3 = new AWS.S3({ region: S3_REGION });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const article = await prisma.article.findFirst({
      where: { id, userId: user.id },
      include: { graphics: { orderBy: { position: 'asc' } } },
    });

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    // Find graphics that have HTML content but no S3 URL yet
    const unreastered = article.graphics.filter((g) => g.htmlContent && !g.s3Url);

    if (unreastered.length === 0) {
      return NextResponse.json({
        message: 'All graphics already rasterized',
        graphics: article.graphics,
      });
    }

    const updatedGraphics = [];

    for (const graphic of unreastered) {
      const dims = getGraphicDimensions(graphic.type);
      const pngBuffer = await rasterizeGraphic(graphic.htmlContent!, dims);

      // Upload to S3
      const s3Path = `publications/${article.publicationId}/graphics/${graphic.id}.png`;
      const s3Key = getS3Key(s3Path);

      await s3
        .putObject({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: pngBuffer,
          ContentType: 'image/png',
        })
        .promise();

      const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;

      const updated = await prisma.articleGraphic.update({
        where: { id: graphic.id },
        data: { s3Key, s3Url },
      });

      updatedGraphics.push(updated);
    }

    // Return all graphics (including already-rasterized ones)
    const allGraphics = await prisma.articleGraphic.findMany({
      where: { articleId: id },
      orderBy: { position: 'asc' },
    });

    return NextResponse.json({ graphics: allGraphics });
  } catch (err) {
    console.error('[POST /api/articles/:id/rasterize-graphics] Error:', err);
    return NextResponse.json({ error: 'Failed to rasterize graphics' }, { status: 500 });
  }
}
