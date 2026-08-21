import type { PresentationAssetSource, PresentationPack } from '@guildmaster/presentation-core';

export const customRemoteAssetHost = 'pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev';
export const customRemoteAssetPolicy = Object.freeze({
  sourceDocument: 'docs/card-data/自定義冒險者格式化資料.md',
  allowedHost: customRemoteAssetHost,
  transport: 'https-only',
  storage: 'client-presentation-only',
  rightsResponsibility: 'user-confirmation-required-before-public-release',
} as const);

const remoteAssetUrls: Readonly<Record<string, string>> = {
  "custom:portrait/starter-melee": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786689520941-3c73f665-27ef-4a47-8fdd-72de45e096ea-4.png",
  "custom:portrait/adventurer-melee-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-c1cec03f-12cf-4d6b-8b17-8b3bd16f1e18-18-.png",
  "custom:portrait/adventurer-melee-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-df5e7ee7-8354-406c-8917-5a4fbffbe358-.png",
  "custom:portrait/adventurer-melee-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-1391deeb-2e33-46c3-96d6-4ce9755d32e7-.png",
  "custom:portrait/adventurer-melee-04": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-8463d3c1-d292-4733-afe3-a975717d6ea9-.png",
  "custom:portrait/adventurer-melee-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-2a2fcb4d-637a-40b4-b3d9-063021091432-.png",
  "custom:portrait/adventurer-melee-06": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-edad7886-afe7-441e-9aa1-7925dd3bd874-Lightning.png",
  "custom:portrait/adventurer-melee-07": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-41b6f096-4515-4e1b-b64a-9ded42d81fc8-tiffa.png",
  "custom:portrait/starter-mage": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786689520941-b2a8fa95-ed56-4760-aae6-1a17ee144199-1.png",
  "custom:portrait/adventurer-mage-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-669b5d54-7297-4ca8-89f6-f846d318bc39-.png",
  "custom:portrait/adventurer-mage-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-0f319399-1f6f-4e60-835f-e00a7755843e-HIKARI.png",
  "custom:portrait/adventurer-mage-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-2d4d2517-c096-415b-8dd7-678d9eee5358-.png",
  "custom:portrait/adventurer-mage-04": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-45493450-ccee-4584-8e5d-e953701a18af-.png",
  "custom:portrait/adventurer-mage-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-a247b6e0-f4be-4507-898b-e01d5018a9db-.png",
  "custom:portrait/adventurer-mage-06": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-0d8abe89-6f3b-44b9-8ce9-f515667c5fa7-.png",
  "custom:portrait/adventurer-mage-07": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-8d5b3b96-7198-41b0-be31-1df065542904-.png",
  "custom:portrait/starter-tank": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786689520941-0ce2453a-1ada-46bc-b846-9f8ab452fee5-3.png",
  "custom:portrait/adventurer-tank-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-9ab9cb00-afb2-4322-a55c-70acc78ea0f7-.png",
  "custom:portrait/adventurer-tank-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-0fdd68f3-d504-4d66-84ee-655ad0e0dd17-.png",
  "custom:portrait/adventurer-tank-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-1dbf99fb-70da-404a-a087-800efc277932-.png",
  "custom:portrait/adventurer-tank-04": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-93991021-b1fc-48b3-b2b5-4470dcf81d1c-Blue-Mary.png",
  "custom:portrait/adventurer-tank-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-7edad5ec-03fb-486c-a7f9-d93a31f81e0b-.png",
  "custom:portrait/adventurer-tank-06": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-e28587b6-d02c-4f0a-ae49-667acee2fc46-.png",
  "custom:portrait/adventurer-tank-07": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-c68d3254-2283-439b-8ee0-779596ff5e28-.png",
  "custom:portrait/adventurer-tank-08": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-639dfe40-1e2c-4c4d-8875-4ebcf6df09d0-.png",
  "custom:portrait/adventurer-tank-09": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-4dcd29a5-4b2f-4a09-9a75-d1d9272f94b4-.png",
  "custom:portrait/starter-support": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786689520941-d35e05f7-0a34-43f5-86a2-a561c6f8dd78-2.png",
  "custom:portrait/adventurer-support-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-94e2d968-2070-4984-8dc3-c9d590d37445-.png",
  "custom:portrait/adventurer-support-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-5e295368-1a7f-46c0-ba29-7062d3a64884-.png",
  "custom:portrait/adventurer-support-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-7fb1c7c7-b8e6-4e10-85de-ab55f6c91516-.png",
  "custom:portrait/adventurer-support-04": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-f07fd09c-c293-43bf-b06b-79416e1c8dc9-HOMURA.png",
  "custom:portrait/adventurer-support-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-6b900ddd-7b9c-4695-b0f4-fca0400ef71c-LUCY.png",
  "custom:portrait/adventurer-support-06": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-951e9871-8397-407d-9f4b-74388d950403-.png",
  "custom:portrait/adventurer-support-07": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-7768c0ba-8cbc-4f79-974d-8ec8eeea82fb-.png",
  "custom:portrait/adventurer-support-08": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-f329f810-55c4-4046-a2ce-5095e7a72e32-.png",
  "custom:portrait/adventurer-support-09": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-bff4bc56-2b8c-4f17-9a81-23fa1d03b9fb-.png",
  "custom:portrait/starter-ranged": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786689520941-1b472575-3974-489b-b7e8-5e45605e80dd-5.png",
  "custom:portrait/adventurer-ranged-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-7b5041df-a788-4b7d-a013-64e933a3826f-.png",
  "custom:portrait/adventurer-ranged-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-70348efd-fb00-4d7c-ba89-7d809cb2dee6-.png",
  "custom:portrait/adventurer-ranged-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688154665-3516e9de-68c7-4a4a-981e-b59dbe0f3f97-SHINO.png",
  "custom:portrait/adventurer-ranged-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E8%A7%92%E8%89%B2/1786688132023-f3efe1a3-836c-43a0-bf3a-85f20e69e204-.png",
  "base:portrait/helper-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-08385f2e-6a53-4a54-be6a-f57248197742-helper-01-wandering-item-merchant-01.png",
  "base:portrait/helper-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-0b51ecee-0a73-4918-b4e2-0634998adb06-helper-02-wandering-item-merchant-02.png",
  "base:portrait/helper-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-1487066d-881a-4e88-b52b-11edc3b65035-helper-03-guild-receptionist-01.png",
  "base:portrait/helper-04": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-bcad8e6a-0b47-422c-bec3-de2d6ae6d84a-helper-04-guild-receptionist-02.png",
  "base:portrait/helper-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-b6616177-9f7c-4e10-a37a-26296712fb9b-helper-05-tavern-owner-01.png",
  "base:portrait/helper-06": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-321598dc-c061-4170-8feb-7cccaffec2df-helper-06-tavern-owner-02.png",
  "base:portrait/helper-07": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-05234e7e-ad05-4663-b825-3a12f87b1ee1-helper-07-mysterious-girl-01.png",
  "base:portrait/helper-08": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-b3d68e6e-6c16-4243-a474-3de66e3a88b8-helper-08-mysterious-girl-02.png",
  "base:portrait/helper-09": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-ba972e5b-6d62-4a62-bb5e-3944d1c32889-helper-09-weapon-shop-owner-01.png",
  "base:portrait/helper-10": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-254faf7a-6c85-4116-9289-b470761e3d3c-helper-10-weapon-shop-owner-02.png",
  "base:portrait/helper-11": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-6fbdad60-b1de-41cb-9939-d55e7134873a-helper-11-information-broker-01.png",
  "base:portrait/helper-12": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-%E5%85%AC%E6%9C%83%E5%A8%98/1787277874194-7bef310e-7127-4f51-8032-f8a0e53c9d96-helper-12-information-broker-02.png",
  "base:portrait/boss-01": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-5501e9c7-95e8-46da-aa12-a4d269690b54-boss-01-red-dragon.png",
  "base:portrait/boss-02": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-40449794-318d-43b9-ae4b-b152c53c4152-boss-02-baphomet.png",
  "base:portrait/boss-03": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-b5c22c6a-308d-4f1c-979a-12fb6eaf48f6-boss-03-lich.png",
  "base:portrait/boss-04": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-9ae8f008-dea3-4265-904d-a2155b69eef0-boss-04-chimera.png",
  "base:portrait/boss-05": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-9ef04913-b771-4443-9396-827cfc951b5b-boss-05-ultimate-mechanical-beast-ex.png",
  "base:portrait/boss-06": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-2943cf25-52cc-4357-88c7-71241e466b9a-boss-06-troll.png",
  "base:portrait/boss-07": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-d898c698-918e-4a13-a9d3-7d272960322c-boss-07-succubus.png",
  "base:portrait/boss-08": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-e05d0544-b46c-4ecc-b412-6cb311d0a930-boss-08-dark-elf.png",
  "base:portrait/boss-09": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-d1e58543-7401-475f-9fbf-8d5c6f784c72-boss-09-harpy.png",
  "base:portrait/boss-10": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-c03cf82c-2f40-4bc6-976f-e15a8e9bc75f-boss-10-slime-girl.png",
  "base:portrait/boss-11": "https://pub-0238f59b333e4bf38dac0e35da86c1a0.r2.dev/uploads/%E5%86%92%E9%9A%AA%E5%85%AC%E6%9C%83-BOSS/1787277864327-84f1dbb7-5a7d-428b-8dca-a217d9a637a5-boss-11-wolf-woman.png"
};

function validatedRemoteSource(source: string): PresentationAssetSource | undefined {
  try {
    const url = new URL(source);
    if (
      url.protocol !== 'https:'
      || url.hostname !== customRemoteAssetHost
      || url.username !== ''
      || url.password !== ''
      || url.hash !== ''
    ) return undefined;
    return { src: url.href, objectPosition: '50% 35%' };
  } catch {
    return undefined;
  }
}

/** Resolves only the user-authorized HTTPS host; failures remain visual-only. */
export function resolveCustomRemoteAsset(assetKey: string): PresentationAssetSource | undefined {
  const source = remoteAssetUrls[assetKey];
  return source ? validatedRemoteSource(source) : undefined;
}

export const customRemoteAssetKeys = Object.freeze(Object.keys(remoteAssetUrls).filter((key) => key.startsWith('custom:')));
export const baseRemoteAssetKeys = Object.freeze(Object.keys(remoteAssetUrls).filter((key) => key.startsWith('base:')));

export const customAmbiguousEffectDefinitionIds = Object.freeze([
  'custom:adventurer/mage-06',
  'custom:adventurer/tank-06',
  'custom:adventurer/tank-07',
  'custom:adventurer/support-09',
] as const);
const ambiguousEffects = new Set<string>(customAmbiguousEffectDefinitionIds);

export const customAdventurerPresentationPack: PresentationPack = {
  manifest: {
    id: 'presentation:custom-adventurers-public',
    version: '0.3.0',
    theme: 'custom-adventurers',
    locale: 'zh-TW',
  },
  entries: ([
    { definitionId: "custom:starter/melee", displayName: "緋月 真紅", portraitAssetKey: "custom:portrait/starter-melee", portraitAltText: "緋月 真紅的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：遊戲設置時直接置入玩家隊伍；因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-01", displayName: "Android 18", portraitAssetKey: "custom:portrait/adventurer-melee-01", portraitAltText: "Android 18的自定義冒險者圖片", shortDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，從物資牌庫抽 1 張牌，並將其置入棄牌堆。", detailDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，從物資牌庫抽 1 張牌，並將其置入棄牌堆。 發動時點：討伐階段結束時。 可略過：否。 持續時間：目前回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-02", displayName: "スカーレット", portraitAssetKey: "custom:portrait/adventurer-melee-02", portraitAltText: "スカーレット的自定義冒險者圖片", shortDisplayText: "此冒險者無法配戴裝備。", detailDisplayText: "此冒險者無法配戴裝備。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-03", displayName: "ミカサ・アッカーマン", portraitAssetKey: "custom:portrait/adventurer-melee-03", portraitAltText: "ミカサ・アッカーマン的自定義冒險者圖片", shortDisplayText: "進入隊伍時，指定場上 1 隻魔物；回合結束前該魔物戰力減少 2。", detailDisplayText: "進入隊伍時，指定場上 1 隻魔物；回合結束前該魔物戰力減少 2。 發動時點：進入隊伍時。 可略過：否。 持續時間：直到目前回合結束。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-04", displayName: "Ellen·Joe", portraitAssetKey: "custom:portrait/adventurer-melee-04", portraitAltText: "Ellen·Joe的自定義冒險者圖片", shortDisplayText: "若此冒險者在隊伍第一位，增加戰力 2。", detailDisplayText: "若此冒險者在隊伍第一位，增加戰力 2。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-05", displayName: "紫苑", portraitAssetKey: "custom:portrait/adventurer-melee-05", portraitAltText: "紫苑的自定義冒險者圖片", shortDisplayText: "隊伍中其他冒險者增加戰力 1。若此冒險者在隊伍第一位，將此冒險者棄至棄牌堆。", detailDisplayText: "隊伍中其他冒險者增加戰力 1。若此冒險者在隊伍第一位，將此冒險者棄至棄牌堆。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-06", displayName: "ライトニング", portraitAssetKey: "custom:portrait/adventurer-melee-06", portraitAltText: "ライトニング的自定義冒險者圖片", shortDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，獲得購買力 2。", detailDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，獲得購買力 2。 發動時點：討伐階段結束時。 可略過：否。 持續時間：目前回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-07", displayName: "ティファ・ロックハート", portraitAssetKey: "custom:portrait/adventurer-melee-07", portraitAltText: "ティファ・ロックハート的自定義冒險者圖片", shortDisplayText: "進入討伐時擲骰子 如果為1-2攻擊力不變 3-4為1.5倍 5-6為兩倍(含裝備加成 小數點無條件捨去)", detailDisplayText: "進入討伐時擲骰子 如果為1-2攻擊力不變 3-4為1.5倍 5-6為兩倍(含裝備加成 小數點無條件捨去) 發動時點：進入討伐時。 可略過：否。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-08", displayName: "阿爾梅斯", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "阿爾梅斯的自定義冒險者圖片", shortDisplayText: "當此冒險者因戰鬥將要棄至棄牌堆時，可以改為放在自己的牌庫頂。", detailDisplayText: "當此冒險者因戰鬥將要棄至棄牌堆時，可以改為放在自己的牌庫頂。 發動時點：因討伐即將離開隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：可改置於自己的牌庫頂；未替代時置入棄牌堆。" },
    { definitionId: "custom:adventurer/melee-09", displayName: "索娜莉亞", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "索娜莉亞的自定義冒險者圖片", shortDisplayText: "若本回合討伐對象為魔物，增加戰力 3。", detailDisplayText: "若本回合討伐對象為魔物，增加戰力 3。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：目前回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:starter/mage", displayName: "天城 紫苑", portraitAssetKey: "custom:portrait/starter-mage", portraitAltText: "天城 紫苑的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：遊戲設置時直接置入玩家隊伍；因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/mage-01", displayName: "布蕾斯", portraitAssetKey: "custom:portrait/adventurer-mage-01", portraitAltText: "布蕾斯的自定義冒險者圖片", shortDisplayText: "進入隊伍時，查看自己牌庫頂 3 張牌；可以移除其中 1 張，其餘牌以任意順序放回自己的牌庫頂。", detailDisplayText: "進入隊伍時，查看自己牌庫頂 3 張牌；可以移除其中 1 張，其餘牌以任意順序放回自己的牌庫頂。 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：可改置於自己的牌庫頂；未替代時置入棄牌堆。" },
    { definitionId: "custom:adventurer/mage-02", displayName: "ヒカリ", portraitAssetKey: "custom:portrait/adventurer-mage-02", portraitAltText: "ヒカリ的自定義冒險者圖片", shortDisplayText: "討伐階段開始時，擲 1 顆骰子；若擲出單數，此冒險者戰力 +1。", detailDisplayText: "討伐階段開始時，擲 1 顆骰子；若擲出單數，此冒險者戰力 +1。 發動時點：討伐階段開始時。 可略過：否。 持續時間：本回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/mage-03", displayName: "アクア", portraitAssetKey: "custom:portrait/adventurer-mage-03", portraitAltText: "アクア的自定義冒險者圖片", shortDisplayText: "可以將魔物或魔王作為裝備配戴在此冒險者上。當此冒險者因戰鬥棄至棄牌堆時，可以用配戴的魔物或魔王作為替代。", detailDisplayText: "可以將魔物或魔王作為裝備配戴在此冒險者上。當此冒險者因戰鬥棄至棄牌堆時，可以用配戴的魔物或魔王作為替代。 發動時點：因討伐即將離開隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/mage-04", displayName: "エアリス・ゲインズブール", portraitAssetKey: "custom:portrait/adventurer-mage-04", portraitAltText: "エアリス・ゲインズブール的自定義冒險者圖片", shortDisplayText: "戰力扣除隊伍中其他冒險者的數量；結果最低為 0。", detailDisplayText: "戰力扣除隊伍中其他冒險者的數量；結果最低為 0。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/mage-05", displayName: "フリーレン", portraitAssetKey: "custom:portrait/adventurer-mage-05", portraitAltText: "フリーレン的自定義冒險者圖片", shortDisplayText: "討伐階段開始時，擲 1 顆骰子；指定場上 1 隻魔物，回合結束前其戰力減少骰子點數的一半，向上取整。", detailDisplayText: "討伐階段開始時，擲 1 顆骰子；指定場上 1 隻魔物，回合結束前其戰力減少骰子點數的一半，向上取整。 發動時點：討伐階段開始時。 可略過：否。 持續時間：直到目前回合結束。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/mage-06", displayName: "めぐみん", portraitAssetKey: "custom:portrait/adventurer-mage-06", portraitAltText: "めぐみん的自定義冒險者圖片", shortDisplayText: "存在於隊伍時 可指定一個敵方的對象生命值減半 然後自身卡片移除遊戲", detailDisplayText: "存在於隊伍時 可指定一個敵方的對象生命值減半 然後自身卡片移除遊戲 發動時點：位於隊伍期間持續生效。 可略過：是。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：效果結算後移出遊戲。" },
    { definitionId: "custom:adventurer/mage-07", displayName: "ロキシー・ミグルディア", portraitAssetKey: "custom:portrait/adventurer-mage-07", portraitAltText: "ロキシー・ミグルディア的自定義冒險者圖片", shortDisplayText: "隊伍中至少有 3 位法師時，每位法師戰力 +2。", detailDisplayText: "隊伍中至少有 3 位法師時，隊伍內每位法師戰力 +2，包含ロキシー自己；只計目前隊伍中的冒險者。條件不成立時立即失去加成。" },
    { definitionId: "custom:adventurer/mage-08", displayName: "莉迪亞", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "莉迪亞的自定義冒險者圖片", shortDisplayText: "此冒險者可以配戴 3 張裝備。", detailDisplayText: "此冒險者可以配戴 3 張裝備。 發動時點：位於隊伍期間持續生效。 可略過：是。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:starter/tank", displayName: "黑瀨 玲奈", portraitAssetKey: "custom:portrait/starter-tank", portraitAltText: "黑瀨 玲奈的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：遊戲設置時直接置入玩家隊伍；因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-01", displayName: "不知火舞", portraitAssetKey: "custom:portrait/adventurer-tank-01", portraitAltText: "不知火舞的自定義冒險者圖片", shortDisplayText: "隊伍第一位冒險者增加戰力 2；修爾蒂本身不適用本效果。", detailDisplayText: "隊伍第一位冒險者增加戰力 2；修爾蒂本身不適用本效果。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-02", displayName: "四楓院夜一", portraitAssetKey: "custom:portrait/adventurer-tank-02", portraitAltText: "四楓院夜一的自定義冒險者圖片", shortDisplayText: "當此冒險者有配戴裝備時，增加戰力 1。", detailDisplayText: "當此冒險者有配戴裝備時，增加戰力 1。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-03", displayName: "松本亂菊", portraitAssetKey: "custom:portrait/adventurer-tank-03", portraitAltText: "松本亂菊的自定義冒險者圖片", shortDisplayText: "進入隊伍時，可以將此冒險者移動到隊伍第一位。", detailDisplayText: "進入隊伍時，可以將此冒險者移動到隊伍第一位。 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-04", displayName: "ブルー・マリー", portraitAssetKey: "custom:portrait/adventurer-tank-04", portraitAltText: "ブルー・マリー的自定義冒險者圖片", shortDisplayText: "進入隊伍時，查看自己牌庫頂的牌；若是道具或裝備，公開該牌並加入手牌。", detailDisplayText: "進入隊伍時，查看自己牌庫頂的牌；若是道具或裝備，公開該牌並加入手牌。 發動時點：進入隊伍時。 可略過：否。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：可改置於自己的牌庫頂；未替代時置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-05", displayName: "マキマ", portraitAssetKey: "custom:portrait/adventurer-tank-05", portraitAltText: "マキマ的自定義冒險者圖片", shortDisplayText: "可以將魔物或魔王作為裝備配戴在此冒險者上；戰力增加所配戴魔物或魔王的購買力。", detailDisplayText: "可以將魔物或魔王作為裝備配戴在此冒險者上；戰力增加所配戴魔物或魔王的購買力。 發動時點：位於隊伍期間持續生效。 可略過：是。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-06", displayName: "ダークネス", portraitAssetKey: "custom:portrait/adventurer-tank-06", portraitAltText: "ダークネス的自定義冒險者圖片", shortDisplayText: "討伐的對象如果攻擊力為 1-5 的話 自身攻擊力+1 6-10的話+2 10以上+3", detailDisplayText: "討伐的對象如果攻擊力為 1-5 的話 自身攻擊力+1 6-10的話+2 10以上+3 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-07", displayName: "ゆんゆん", portraitAssetKey: "custom:portrait/adventurer-tank-07", portraitAltText: "ゆんゆん的自定義冒險者圖片", shortDisplayText: "一回合中可以忽略一次因討伐而進入棄牌區的效果", detailDisplayText: "一回合中可以忽略一次因討伐而進入棄牌區的效果 發動時點：因討伐即將離開隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：成功忽略時留在隊伍；否則置入棄牌堆。" },
    { definitionId: "custom:adventurer/tank-08", displayName: "ルミナス・バレンタイン", portraitAssetKey: "custom:portrait/adventurer-tank-08", portraitAltText: "ルミナス・バレンタイン的自定義冒險者圖片", shortDisplayText: "此冒險者可以作為裝備，配戴在其他冒險者上；配戴的冒險者增加戰力 2。", detailDisplayText: "此冒險者可以作為裝備，配戴在其他冒險者上；配戴的冒險者增加戰力 2。 發動時點：位於隊伍期間持續生效。 可略過：是。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：作為裝備時附著於指定冒險者；附件離場規則待確認。" },
    { definitionId: "custom:adventurer/tank-09", displayName: "ヨル・フォージャー", portraitAssetKey: "custom:portrait/adventurer-tank-09", portraitAltText: "ヨル・フォージャー的自定義冒險者圖片", shortDisplayText: "隊伍中至少有 3 位坦克時，每位坦克戰力 +2。", detailDisplayText: "隊伍中至少有 3 位坦克時，隊伍內每位坦克戰力 +2，包含ヨル・フォージャー自己；只計目前隊伍中的冒險者。條件不成立時立即失去加成。" },
    { definitionId: "custom:adventurer/tank-10", displayName: "米莉安", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "米莉安的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:starter/support", displayName: "夜凪 櫻", portraitAssetKey: "custom:portrait/starter-support", portraitAltText: "夜凪 櫻的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：遊戲設置時直接置入玩家隊伍；因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-01", displayName: "月詠", portraitAssetKey: "custom:portrait/adventurer-support-01", portraitAltText: "月詠的自定義冒險者圖片", shortDisplayText: "進入隊伍時，可以移除自己棄牌堆中的 1 張牌。", detailDisplayText: "進入隊伍時，可以移除自己棄牌堆中的 1 張牌。 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-02", displayName: "朽木ルキア", portraitAssetKey: "custom:portrait/adventurer-support-02", portraitAltText: "朽木ルキア的自定義冒險者圖片", shortDisplayText: "購買階段時，商店內所有裝備費用減少 1。", detailDisplayText: "購買階段時，商店內所有裝備費用減少 1。 發動時點：購買階段。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-03", displayName: "釘崎野薔薇", portraitAssetKey: "custom:portrait/adventurer-support-03", portraitAltText: "釘崎野薔薇的自定義冒險者圖片", shortDisplayText: "進入隊伍時，抽 3 張牌，然後從手牌中棄 1 張牌。", detailDisplayText: "進入隊伍時，抽 3 張牌，然後從手牌中棄 1 張牌。 發動時點：進入隊伍時。 可略過：否。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-04", displayName: "ホムラ", portraitAssetKey: "custom:portrait/adventurer-support-04", portraitAltText: "ホムラ的自定義冒險者圖片", shortDisplayText: "相鄰的冒險者增加戰力 1。", detailDisplayText: "相鄰的冒險者增加戰力 1。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-05", displayName: "Lucy", portraitAssetKey: "custom:portrait/adventurer-support-05", portraitAltText: "Lucy的自定義冒險者圖片", shortDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，可以從棄牌堆取回 1 張冒險者至手牌。", detailDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，可以從棄牌堆取回 1 張冒險者至手牌。 發動時點：討伐階段結束時。 可略過：是。 持續時間：目前回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-06", displayName: "結城明日奈", portraitAssetKey: "custom:portrait/adventurer-support-06", portraitAltText: "結城明日奈的自定義冒險者圖片", shortDisplayText: "進入隊伍時，可以任意調整隊員的位置。", detailDisplayText: "進入隊伍時，可以任意調整隊員的位置。 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-07", displayName: "Jessie", portraitAssetKey: "custom:portrait/adventurer-support-07", portraitAltText: "Jessie的自定義冒險者圖片", shortDisplayText: "進入隊伍時，抽 1 張牌。當此冒險者配戴裝備時，抽 1 張牌。", detailDisplayText: "進入隊伍時，抽 1 張牌。當此冒險者配戴裝備時，抽 1 張牌。 發動時點：進入隊伍時。 可略過：否。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-08", displayName: "リノア・ハーティリー", portraitAssetKey: "custom:portrait/adventurer-support-08", portraitAltText: "リノア・ハーティリー的自定義冒險者圖片", shortDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，可以從手牌、隊伍或棄牌堆中移除 1 張牌。", detailDisplayText: "討伐階段結束時，若本回合有擊敗魔物或魔王，可以從手牌、隊伍或棄牌堆中移除 1 張牌。 發動時點：討伐階段結束時。 可略過：是。 持續時間：目前回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-09", displayName: "ジュナ", portraitAssetKey: "custom:portrait/adventurer-support-09", portraitAltText: "ジュナ的自定義冒險者圖片", shortDisplayText: "加入隊伍時可以立即更換公會小姐", detailDisplayText: "加入隊伍時可以立即更換公會小姐 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/support-10", displayName: "尤伊爾", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "尤伊爾的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:starter/ranged", displayName: "九條 霧香", portraitAssetKey: "custom:portrait/starter-ranged", portraitAltText: "九條 霧香的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：遊戲設置時直接置入玩家隊伍；因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/ranged-01", displayName: "Ada Wong", portraitAssetKey: "custom:portrait/adventurer-ranged-01", portraitAltText: "Ada Wong的自定義冒險者圖片", shortDisplayText: "當此冒險者在隊伍第四或第五位時，增加戰力 1。", detailDisplayText: "當此冒險者在隊伍第四或第五位時，增加戰力 1。 發動時點：位於隊伍期間持續生效。 可略過：否。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/ranged-02", displayName: "シオン・アイメリス", portraitAssetKey: "custom:portrait/adventurer-ranged-02", portraitAltText: "シオン・アイメリス的自定義冒險者圖片", shortDisplayText: "進入隊伍時，可以選擇場上任意數量的魔物，將其放回魔物牌庫底，並翻出等量魔物。", detailDisplayText: "進入隊伍時，可以選擇場上任意數量的魔物，將其放回魔物牌庫底，並翻出等量魔物。 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/ranged-03", displayName: "詩乃", portraitAssetKey: "custom:portrait/adventurer-ranged-03", portraitAltText: "詩乃的自定義冒險者圖片", shortDisplayText: "只要在隊伍內 即使沒有參與討伐 攻擊力也可以加算到隊伍的第一位玩家身上 如果自己本身就是第一位 或是有參與到該次討伐 則不另外加算攻擊力", detailDisplayText: "只要在隊伍內 即使沒有參與討伐 攻擊力也可以加算到隊伍的第一位玩家身上 如果自己本身就是第一位 或是有參與到該次討伐 則不另外加算攻擊力 發動時點：位於隊伍期間持續生效。 可略過：是。 持續時間：此卡位於指定位置且條件成立期間。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/ranged-04", displayName: "莉莉西斯", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "莉莉西斯的自定義冒險者圖片", shortDisplayText: "進入隊伍的回合，購買階段時，魔物或魔王的購買力增加 1。", detailDisplayText: "進入隊伍的回合，購買階段時，魔物或魔王的購買力增加 1。 發動時點：進入隊伍時。 可略過：否。 持續時間：目前回合。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/ranged-05", displayName: "レゼ", portraitAssetKey: "custom:portrait/adventurer-ranged-05", portraitAltText: "レゼ的自定義冒險者圖片", shortDisplayText: "進入隊伍時 可選擇手牌中一張道具卡執行兩次效果", detailDisplayText: "進入隊伍時 可選擇手牌中一張道具卡執行兩次效果 發動時點：進入隊伍時。 可略過：是。 持續時間：立即結算；衍生修正依完整效果指定。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" },
    { definitionId: "custom:adventurer/ranged-06", displayName: "尤伊爾", portraitAssetKey: "placeholder:custom-adventurer", portraitAltText: "尤伊爾的自定義冒險者圖片", shortDisplayText: "無特殊效果。", detailDisplayText: "無特殊效果。 最後目的地：因戰鬥離場時依一般規則置入棄牌堆。" }
  ] as PresentationPack['entries']).map((entry) => ambiguousEffects.has(entry.definitionId)
    ? {
        ...entry,
        shortDisplayText: `${entry.shortDisplayText}（技能尚未啟用）`,
        detailDisplayText: `${entry.detailDisplayText} 本模式僅套用卡牌數值；技能因關鍵規則仍有歧義而停用。`,
      }
    : entry),
};
