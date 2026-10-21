import { Card } from "@/components/ui/card";
import { DecisionForm } from "../_components/DecisionAdminForms";
import { getDecisionFormOptions } from "../_data";

export const metadata = { title: "Nouvelle décision (admin)", robots: { index: false } };

export default async function NewDecisionPage() {
  const { institutions, sources } = await getDecisionFormOptions();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-display font-bold tracking-tight">Nouvelle décision</h1>
      <p className="text-sm text-muted-foreground">
        Saisir uniquement ce que la source établit. La notice reste un brouillon jusqu{"'"}à sa
        revue.
      </p>
      <Card className="p-4">
        <DecisionForm institutions={institutions} sources={sources} />
      </Card>
    </div>
  );
}
