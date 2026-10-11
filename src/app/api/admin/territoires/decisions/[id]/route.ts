import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { withValidation } from "@/lib/security/validate";
import { getRequestMeta } from "@/lib/security/audit";
import { decisionSchema } from "@/lib/security/schemas/decision-territoriale";
import { updateDecision } from "@/lib/territoires/decisions";

export const PATCH = withAdminAuth(
  withValidation(decisionSchema, async (request, context, body) => {
    const { id } = await context.params;
    const result = await updateDecision(id!, body, getRequestMeta(request));
    if (!result.ok)
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    return NextResponse.json({ id: result.id, status: result.status });
  })
);
