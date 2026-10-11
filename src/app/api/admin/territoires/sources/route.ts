import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { withValidation } from "@/lib/security/validate";
import { getRequestMeta } from "@/lib/security/audit";
import { territorialSourceSchema } from "@/lib/security/schemas/decision-territoriale";
import { createTerritorialSource } from "@/lib/territoires/decisions";

export const POST = withAdminAuth(
  withValidation(territorialSourceSchema, async (request, _ctx, body) => {
    const result = await createTerritorialSource(body, getRequestMeta(request));
    if (!result.ok)
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    return NextResponse.json({ id: result.id }, { status: 201 });
  })
);
