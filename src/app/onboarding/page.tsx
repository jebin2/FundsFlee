"use client";

import { useSession } from "next-auth/react";
import { STEPS, useOnboardingFlow } from "@/features/onboarding/hooks/useOnboardingFlow";
import { WelcomeStep }  from "@/features/onboarding/components/WelcomeStep";
import { SheetStep }    from "@/features/onboarding/components/SheetStep";
import { ProfileStep }  from "@/features/onboarding/components/ProfileStep";
import { ShortcutStep } from "@/features/onboarding/components/ShortcutStep";
import { DoneStep }     from "@/features/onboarding/components/DoneStep";

export default function OnboardingPage() {
  const { data: session } = useSession();
  const flow = useOnboardingFlow();
  const { step, stepIndex } = flow;
  const userName = session?.user?.name ?? "";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--color-background)" }}>
      <div className="h-1 w-full" style={{ background: "var(--color-surface-container)" }}>
        <div
          className="h-1 transition-all duration-500"
          style={{ background: "var(--color-primary)", width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full px-6 py-8">
        <div className="flex justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className="rounded-full transition-all"
              style={{ width: i === stepIndex ? 24 : 8, height: 8, background: i <= stepIndex ? "var(--color-primary)" : "var(--color-outline-variant)" }}
            />
          ))}
        </div>

        {step === "welcome"  && <WelcomeStep  userName={userName} loading={flow.loading} onInitSheet={flow.initSheet} />}
        {step === "sheet"    && <SheetStep    sheetUrl={flow.sheetUrl} userName={userName} onContinue={() => flow.goToStep("profile")} />}
        {step === "profile"  && <ProfileStep  region={flow.region} setRegion={flow.setRegion} tags={flow.tags} toggleTag={flow.toggleTag} onSkip={() => flow.goToStep("shortcut")} onContinue={flow.saveProfileAndContinue} />}
        {step === "shortcut" && <ShortcutStep token={flow.token} onSkip={() => flow.goToStep("done")} onDone={() => flow.goToStep("done")} />}
        {step === "done"     && <DoneStep     onFinish={flow.finish} />}
      </div>
    </div>
  );
}
