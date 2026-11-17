import { NextRequest } from "next/server";
import { presidentAccessPost } from "@/lib/president-access-http";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){return presidentAccessPost(req,true);}
