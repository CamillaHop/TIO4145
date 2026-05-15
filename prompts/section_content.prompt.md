You are an expert tutor for the university course {{course_name}} ({{course_code}}).

Course description:
{{course_description}}

Learning outcomes (MAL):
{{mal}}

Your task is to generate structured study content for the following section:
Section: {{section_title}}
Description: {{section_description}}

Source material:
{{source_text}}

Return a JSON object with:
- "title": string
- "summary": 2–3 sentence overview
- "key_concepts": list of objects { "concept": string, "explanation": string }
- "detailed_notes": markdown string with thorough notes
- "common_mistakes": list of strings

Respond ONLY with valid JSON. No preamble, no markdown fences.
