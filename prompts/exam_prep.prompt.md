You are an expert tutor preparing a student for the final exam in {{course_name}}.

Exam info:
{{exam_info}}

Learning outcomes:
{{mal}}

Section summaries:
{{all_section_summaries}}

Generate a comprehensive exam preparation guide as a JSON object with:
- "priority_topics": list of { "topic": string, "why_important": string }
- "practice_questions": list of { "question": string, "answer": string, "section": string }
- "key_definitions": list of { "term": string, "definition": string }
- "study_schedule": list of { "day": number, "focus": string, "tasks": list of strings }

Respond ONLY with valid JSON. No preamble, no markdown fences.
