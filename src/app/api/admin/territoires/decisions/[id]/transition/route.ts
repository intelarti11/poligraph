import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { withValidation } from "@/lib/security/validate";
import { getRequestMeta } from "@/lib/security/audit";
import { decisionTransitionSchema } from "@/lib/security/schemas/decision-territoriale";
import { transitionDecision } from "@/lib/territoires/decisions";

export const POST = withAdminAuth(
  withValidation(decisionTransitionSchema, async (request, context, body) => {
    const { id } = await context.params;
    const result = await transitionDecision(id!, body, getRequestMeta(request));
    if (!result.ok)
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    return NextResponse.json({ id: result.id, status: result.status });
  })
);
