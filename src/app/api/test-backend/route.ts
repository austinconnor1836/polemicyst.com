// src/app/api/test-backend/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("http://host.docker.internal:3001/api/ping"); // 👈 direct to Docker container
    const data = await res.json();
    return NextResponse.json({ backendResponse: data });
  } catch (error: any) {
    console.error("API Test Error:", error);
    return NextResponse.json(
      { error: error.message || "Something went wrong" },
      { status: 500 }
    );
  }
}
