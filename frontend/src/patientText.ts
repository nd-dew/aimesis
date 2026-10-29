// Plain-language explanations shared by the patient view and the drawing.
export const SWALLOW: Record<string, string> = {
  tablets: 'Can swallow tablets: oral tablets are fine.',
  liquid_only: 'Liquids only: oral liquid formulations, no tablets.',
  ng_tube: 'Nasogastric tube: drugs go through the tube.',
  iv_only: 'IV only: nothing by mouth.',
};

export const CATEGORY: Record<string, string> = {
  ALL: 'Acute lymphoblastic leukaemia: dexamethasone is hard-blocked (already in the protocol).',
  AML: 'Acute myeloid leukaemia: dexamethasone not preferred (soft warning).',
  BRAIN_TUMOR: 'Brain tumour: dexamethasone is hard-blocked.',
  OTHER: 'No diagnosis-based steroid rule applies.',
};
