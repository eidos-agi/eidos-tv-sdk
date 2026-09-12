import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const lifeTools = [
  {
    name: "life.open",
    description: "Open a delegated job on the TV.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "life.observe",
    description: "Observe the personal AI home and simulated delegated jobs.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "life.request",
    description:
      "Submit an instruction to a simulated worker. No external actions are taken.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "life.cancel",
    description: "Cancel a pending simulated job.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "life.remote",
    description: "Operate the Life Center remote.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          enum: [
            "Left",
            "Right",
            "Up",
            "Down",
            "Select",
            "Back",
            "Home",
            "Power",
          ],
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
];
const prompts = [
  "What needs my attention?",
  "Prepare my next trip",
  "Help me plan tomorrow",
];
type Job = {
  id: string;
  text: string;
  createdAt: number;
  cancelled: boolean;
  kind: "briefing" | "travel" | "planning" | "other";
};
type State = {
  jobs: Job[];
  focus: number;
  power: boolean;
  selected: string | null;
};
export class LifeCenter {
  private state: State = { jobs: [], focus: 0, power: true, selected: null };
  private file: string;
  constructor(
    directory: string,
    private clock = Date.now,
  ) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, "life-center.json");
    try {
      this.state = JSON.parse(readFileSync(this.file, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  private save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.state), {
      mode: 0o600,
    });
    renameSync(this.file + ".tmp", this.file);
  }
  observe() {
    return {
      ...this.state,
      mode: "simulated",
      prompts,
      tools: lifeTools,
      jobs: this.state.jobs.map((j) => {
        const elapsed = this.clock() - j.createdAt;
        const status = j.cancelled
          ? "cancelled"
          : elapsed < 1500
            ? "queued"
            : elapsed < 4500
              ? "working"
              : "completed";
        const worker =
          j.kind === "travel"
            ? "Travel worker"
            : j.kind === "planning"
              ? "Planning worker"
              : "Personal assistant";
        const result =
          j.kind === "briefing"
            ? "Demo briefing: review tomorrow’s schedule, finish your packing list, and choose your top priority. These are sample items; no personal accounts are connected."
            : j.kind === "travel"
              ? "Demo travel checklist: confirm destination and dates, compare transport and lodging, and prepare documents and packing. Tell a connected worker your destination to turn this into a real plan. No bookings were made."
              : j.kind === "planning"
                ? "Demo plan: reserve a focused morning block, group errands in the afternoon, and leave an evening buffer. No calendar entries were created."
                : "Your request reached the simulated worker. A real worker integration is needed to answer this specific instruction; no external work was performed.";
        return {
          ...j,
          status,
          worker,
          steps: [
            "Instruction received",
            ...(elapsed >= 1500 ? ["Delegated to " + worker] : []),
            ...(status === "completed" ? ["Sample result ready"] : []),
          ],
          result: status === "completed" ? result : null,
        };
      }),
    };
  }
  call(name: string, input: unknown): ReturnType<LifeCenter["observe"]> {
    if (name === "life.observe") {
      z.object({}).strict().parse(input);
      return this.observe();
    }
    if (name === "life.request") {
      const { text } = z
        .object({ text: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(input);
      if (this.state.jobs.length >= 200) throw Error("JOB_LIMIT_REACHED");
      const kind = /trip|travel|pack/i.test(text)
        ? "travel"
        : /tomorrow|plan|schedule/i.test(text)
          ? "planning"
          : /attention|brief/i.test(text)
            ? "briefing"
            : "other";
      const job: Job = {
        id: randomUUID(),
        text,
        kind,
        createdAt: this.clock(),
        cancelled: false,
      };
      this.state.jobs.unshift(job);
      this.state.selected = job.id;
    } else if (name === "life.open") {
      const { id } = z.object({ id: z.string() }).strict().parse(input);
      if (!this.state.jobs.some((j) => j.id === id))
        throw Error("JOB_NOT_FOUND");
      this.state.selected = id;
    } else if (name === "life.cancel") {
      const { id } = z.object({ id: z.string() }).strict().parse(input);
      const job = this.state.jobs.find((j) => j.id === id);
      if (!job) throw Error("JOB_NOT_FOUND");
      if (this.clock() - job.createdAt >= 4500)
        throw Error("JOB_ALREADY_FINISHED");
      job.cancelled = true;
    } else if (name === "life.remote") {
      const { key } = z
        .object({
          key: z.enum([
            "Left",
            "Right",
            "Up",
            "Down",
            "Select",
            "Back",
            "Home",
            "Power",
          ]),
        })
        .strict()
        .parse(input);
      if (key === "Power") this.state.power = !this.state.power;
      else if (this.state.power) {
        if (key === "Home" || key === "Back") {
          this.state.selected = null;
          this.state.focus = 0;
        } else if (["Left", "Up", "Right", "Down"].includes(key))
          this.state.focus =
            (this.state.focus +
              (["Left", "Up"].includes(key) ? -1 : 1) +
              3 +
              this.state.jobs.length) %
            (3 + this.state.jobs.length);
        else if (key === "Select") {
          if (this.state.focus < 3)
            return this.call("life.request", {
              text: prompts[this.state.focus],
            });
          this.state.selected =
            this.state.jobs[this.state.focus - 3]?.id ?? null;
        }
      }
    } else throw Error("UNKNOWN_TOOL");
    this.save();
    return this.observe();
  }
}
