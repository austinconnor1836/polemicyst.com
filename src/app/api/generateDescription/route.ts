// /src/app/api/generateDescription/route.ts
export async function POST(req: Request) {
  const formData = await req.formData();

  const backendRes = await fetch("http://localhost:3001/api/generate", {
    method: "POST",
    body: formData,
  });

  const raw = await backendRes.text();

  return new Response(raw, {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
