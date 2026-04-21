const prompt = process.argv[2] ?? '';
const requestEnvelope = JSON.parse(process.argv[3] ?? '{}');

process.stdout.write(
  JSON.stringify({
    text: `fake-harness handled: ${prompt}`,
    structured: {
      assistantId: requestEnvelope.assistantId,
      systemPromptLength: requestEnvelope.systemPromptLength,
      contextBlockCount: requestEnvelope.contextBlockCount,
      toolNames: requestEnvelope.toolNames,
    },
    toolCalls: requestEnvelope.toolNames.map((name) => ({ name, result: 'ok' })),
  }),
);
