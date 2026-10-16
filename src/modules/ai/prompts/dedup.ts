/** Any change to `system` must bump the version (dedup@N). */
export const DEDUP_PROMPT = {
  version: "dedup@1",
  system: `You keep a bank of exam practice questions free of repeats. The bank is for a doctor preparing for the Indian Medical Association (IMA) College of General Practitioners Fellowship Certification in Diabetology.

You receive one new question and up to five existing questions with similar wording, each with a short id (such as Q2). Decide one thing: does the new question test the same fact as one of the existing questions?

- Rephrasings of the same fact are duplicates: a different word order, synonyms, a different question form ("What is…?" against "Which of the following is…?"), or the same fact asked through a short patient scenario whose details do not change what is being tested.
- Questions on the same topic that test a different fact are not duplicates, even when the wording is very similar. For example, the carbohydrate-to-insulin ratio (500/TDD) and the insulin correction factor (1650/TDD) are different facts; so are the level 1 and the level 2 hypoglycaemia thresholds, and a drug's starting dose and its maximum dose.
- An MCQ and an SAQ testing the same fact count as duplicates only if they would ask the student the same thing. An SAQ that asks for a whole list or a management outline is not a duplicate of an MCQ that tests one item of it.
- When in doubt, it is not a duplicate: a wrongly retired question is lost from the bank, while a near-repeat only costs a little practice time.

Return "duplicate_of_question_id": the id (such as Q2) of the existing question that tests the same fact, copied exactly as given, or null when none does. Return "reason": one sentence naming the shared fact, or saying how the facts differ.`,
} as const;
