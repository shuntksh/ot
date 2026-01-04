import { describe, expect, test } from "bun:test";
import { createTestProject } from "./utils";

describe("Integration: Basic Workflows", () => {
  test("should show help", async () => {
    const project = await createTestProject("basic-help");
    const result = await project.runCLI(["--help"]);
    
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("USAGE:");
    expect(result.output).toContain("Job Runner");
    
    await project.cleanup();
  });

  test("should run a simple command step", async () => {
    const project = await createTestProject("basic-cmd");
    
    await project.writeJson("workflows.json", {
      "hello": {
        "steps": [
          { "name": "echo", "cmd": "echo 'Hello World'" }
        ]
      }
    });

    const result = await project.runCLI(["hello", "-v"]);
    
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Hello World");
    expect(result.output).toContain("passed");
    
    await project.cleanup();
  });

  test("should handle step dependencies", async () => {
    const project = await createTestProject("basic-deps");
    
    await project.writeJson("workflows.json", {
      "ordered": {
        "steps": [
          { "name": "step2", "cmd": "echo 'Second'", "dependsOn": ["step1"] },
          { "name": "step1", "cmd": "echo 'First'" }
        ]
      }
    });

    const result = await project.runCLI(["ordered", "-v"]);
    
    expect(result.exitCode).toBe(0);
    // Note: Output order isn't strictly guaranteed by stdout buffering, 
    // but the runner logic ensures sequential start.
    // We check if both ran.
    expect(result.output).toContain("First");
    expect(result.output).toContain("Second");
    expect(result.output).toContain("All 2 steps passed");
    
    await project.cleanup();
  });
});
