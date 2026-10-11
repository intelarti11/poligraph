import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { withValidation } from "@/lib/security/validate";
import { getRequestMeta } from "@/lib/security/audit";
import { decisionSchema } from "@/lib/security/schemas/decision-territoriale";
import { createDecision } from "@/lib/territoires/decisions";

export const POST = withAdminAuth(
  withValidation(decisionSchema, async (request, _ctx, body) => {
    const result = await createDecision(body, getRequestMeta(request));
    if (!result.ok)
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    return NextResponse.json({ id: result.id, status: result.status }, { status: 201 });
  })
);
