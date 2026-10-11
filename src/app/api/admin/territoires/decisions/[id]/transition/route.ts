import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { withValidation } from "@/lib/security/validate";
import { getRequestMeta } from "@/lib/security/audit";
import { decisionTransitionSchema } from "@/lib/security/schemas/decision-territoriale";
import { requestProfileRefresh } from "@/lib/politicians/profile-snapshot/request";
import { municipalPoliticianIds, transitionDecision } from "@/lib/territoires/decisions";

export const POST = withAdminAuth(
  withValidation(decisionTransitionSchema, async (request, context, body) => {
    const { id } = await context.params;
    const result = await transitionDecision(id!, body, getRequestMeta(request));
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.httpStatus });
    }
    // The profile of each municipal elected official links to the commune's decisions only
    // while one is published: the document must be recomputed when that changes.
    if (result.visibilityChanged) {
      const politicianIds = await municipalPoliticianIds(result.communeId);
      if (politicianIds.length > 0) {
        await requestProfileRefresh({ politicianIds }, "territorial-decision-visibility");
      }
    }
    return NextResponse.json({ id: result.id, status: result.status });
  })
);
