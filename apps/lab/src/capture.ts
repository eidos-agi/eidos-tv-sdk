import { toPng, toCanvas } from "html-to-image";
export function download(data: Blob | string, name: string) {
  const a = document.createElement("a");
  a.href = typeof data === "string" ? data : URL.createObjectURL(data);
  a.download = name;
  a.click();
  if (typeof data !== "string")
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export async function snapshot(node: HTMLElement) {
  const png = await toPng(node, { pixelRatio: 1, cacheBust: true });
  download(png, "eidos-tv-frame.png");
  return png;
}
export async function record(
  node: HTMLElement,
  onError: (message: string) => void,
) {
  const canvas = await toCanvas(node, { pixelRatio: 1 });
  const context = canvas.getContext("2d")!;
  const stream = canvas.captureStream(8);
  const mime = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw Error("WebM recording is unavailable in this browser");
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  let active = true;
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    download(new Blob(chunks, { type: mime }), "eidos-tv-recording.webm");
  };
  async function frame() {
    if (!active) return;
    try {
      const image = await toCanvas(node, { pixelRatio: 1 });
      if (active) context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      onError((e as Error).message);
      active = false;
      if (recorder.state !== "inactive") recorder.stop();
    }
    if (active) setTimeout(() => void frame(), 125);
  }
  recorder.start();
  void frame();
  return () => {
    active = false;
    if (recorder.state !== "inactive") recorder.stop();
  };
}
