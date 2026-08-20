# Commit Message Instructions

Generate the commit subject from the current branch name and the actual staged diff. If nothing is staged, use the working-tree diff.

## Rules

1. Read the current branch before generating the subject.
2. If the branch contains exactly one uppercase ticket key followed by digits, such as `GPBWAI-3973`, prefix the subject with it.
3. Do not invent, duplicate, or guess a ticket.
4. Use one concise imperative subject that describes the real change.
5. Exclude unrelated implementation detail.

Preferred form: `GPBWAI-3973 add capability fallback validation`

Return the final subject on the first line.

