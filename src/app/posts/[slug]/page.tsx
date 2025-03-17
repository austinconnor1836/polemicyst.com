import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllPosts, getPostBySlug } from '@/lib/api';
import markdownToHtml from '@/lib/markdownToHtml';
import Container from '@/app/_components/container';
import Header from '@/app/_components/header';
import { PostBody } from '@/app/_components/post-body';
import { PostHeader } from '@/app/_components/post-header';

// 🚨 REMOVE ALL EXPLICIT TYPES TEMPORARILY
export default async function Post({ params }: any) {
  const post = await getPostBySlug(params.slug);

  if (!post) {
    return notFound();
  }

  const content = await markdownToHtml(post.content || '');

  return (
    <main>
      <Container>
        <Header />
        <article className="mb-32">
          <PostHeader
            title={post.title}
            coverImage={post.coverImage}
            date={post.date}
            author={post.author}
          />
          <PostBody content={content} />
        </article>
      </Container>
    </main>
  );
}

export async function generateMetadata({ params }: any) {
  const post = await getPostBySlug(params.slug);

  if (!post) {
    return undefined;
  }

  return {
    title: `${post.title} | Blog of Polemicyst`,
    openGraph: {
      title: post.title,
      images: post.ogImage ? [post.ogImage.url] : [],
    },
  };
}

export async function generateStaticParams() {
  const posts = await getAllPosts();

  return posts.map((post) => ({
    params: { slug: post.slug },
  }));
}
