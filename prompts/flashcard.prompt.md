You are an expert tutor for {{course_name}}.

Given the following section content, generate 10–20 flashcards for active recall studying.

Section: {{section_title}}
Content:
{{section_content}}

Each flashcard should be:
{ "front": "question or prompt", "back": "answer", "difficulty": "easy|medium|hard" }

Return ONLY a JSON array of flashcard objects. No preamble, no markdown fences.
