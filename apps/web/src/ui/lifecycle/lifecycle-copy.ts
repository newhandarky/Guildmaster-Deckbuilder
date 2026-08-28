import type { CounterConsentPolicyRef } from '@guildmaster/game-protocol';

export type LifecycleChoiceCopy = {
  choiceId: string;
  title: string;
  description?: string;
  optionLabels?: Readonly<Record<string, string>>;
};

export type LifecycleConsentCopy = {
  moduleId: string;
  policyId: string;
  title: string;
  description: string;
};

export type LifecycleCopyCatalog = {
  choices?: readonly LifecycleChoiceCopy[];
  consents?: readonly LifecycleConsentCopy[];
};

export type ResolvedChoiceCopy = {
  title: string;
  description: string;
  optionLabel: (optionId: string, index: number) => string;
};

export type LifecycleCopyResolver = {
  resolveChoice: (choiceId: string) => ResolvedChoiceCopy;
  resolveConsent: (policy: CounterConsentPolicyRef) => LifecycleConsentCopy | undefined;
};

const commonOptionLabels: Readonly<Record<string, string>> = Object.freeze({
  continue: '繼續',
  confirm: '確認',
  skip: '略過',
  cancel: '取消',
  accept: '接受',
  decline: '拒絕',
});

const consentKey = ({ moduleId, policyId }: CounterConsentPolicyRef): string => `${moduleId}\u0000${policyId}`;

export function createLifecycleCopyResolver(catalog: LifecycleCopyCatalog = {}): LifecycleCopyResolver {
  const choices = new Map((catalog.choices ?? []).map((copy) => [copy.choiceId, copy]));
  const consents = new Map((catalog.consents ?? []).map((copy) => [consentKey(copy), copy]));
  return {
    resolveChoice(choiceId) {
      const copy = choices.get(choiceId);
      return {
        title: copy?.title ?? '請選擇如何繼續',
        description: copy?.description ?? '這項規則必須先完成選擇，對局才會繼續。',
        optionLabel(optionId, index) {
          const semanticSuffix = optionId.includes(':') ? optionId.slice(optionId.lastIndexOf(':') + 1) : optionId;
          return copy?.optionLabels?.[optionId]
            ?? commonOptionLabels[optionId]
            ?? commonOptionLabels[semanticSuffix]
            ?? `選項 ${index + 1}`;
        },
      };
    },
    resolveConsent(policy) {
      return consents.get(consentKey(policy));
    },
  };
}

export const defaultLifecycleCopyResolver = createLifecycleCopyResolver();
