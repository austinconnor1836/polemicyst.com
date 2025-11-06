export async function getNewVideoFromFeed(sourceUrl: string, lastId?: string) {
  // Simulate fetching a video with a unique timestamp ID
  const fakeVideoId = Date.now().toString();

  if (fakeVideoId === lastId) return null;

  return {
    id: fakeVideoId,
    title: `New Video from ${sourceUrl}`,
    url: sourceUrl + `?v=${fakeVideoId}`,
  };
}
