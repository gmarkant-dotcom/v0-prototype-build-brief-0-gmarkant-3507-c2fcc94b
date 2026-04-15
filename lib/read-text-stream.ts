export async function readTextStream(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (fullText: string, chunk: string) => void
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let fullText = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    const chunk = decoder.decode(value, { stream: true })
    fullText += chunk
    onChunk?.(fullText, chunk)
  }

  return fullText
}
