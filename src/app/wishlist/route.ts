import { NextResponse } from "next/server";

export function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/account/watch";
  return NextResponse.redirect(url);
}
