import { describe, expect, test } from "vite-plus/test";

import { buildPlantUmlUrl, preparePlantUmlSource } from "./plantuml";

describe("preparePlantUmlSource", () => {
  test("injects a light theme when the source has no explicit styling directives", () => {
    const code = "@startuml\nAlice -> Bob: hi\n@enduml";

    expect(preparePlantUmlSource(code, "light")).toBe(
      "@startuml\n!theme spacelab\nAlice -> Bob: hi\n@enduml",
    );
  });

  test("injects a dark theme when the source has no explicit styling directives", () => {
    const code = "@startuml\nAlice -> Bob: hi\n@enduml";

    expect(preparePlantUmlSource(code, "dark")).toBe(
      "@startuml\n!theme cyborg\nAlice -> Bob: hi\n@enduml",
    );
  });

  test("does not inject a theme when the source already defines one", () => {
    const code = "@startuml\n!theme materia\nAlice -> Bob: hi\n@enduml";

    expect(preparePlantUmlSource(code, "dark")).toBe(code);
  });

  test("does not inject a theme when the source uses skinparam", () => {
    const code = "@startuml\nskinparam backgroundColor #111111\nAlice -> Bob: hi\n@enduml";

    expect(preparePlantUmlSource(code, "dark")).toBe(code);
  });

  test("does not inject a theme when the source uses include directives", () => {
    const code = "@startuml\n!include https://example.com/theme.puml\nAlice -> Bob: hi\n@enduml";

    expect(preparePlantUmlSource(code, "dark")).toBe(code);
  });
});

describe("buildPlantUmlUrl", () => {
  test("encodes a simple sequence diagram with raw deflate output", () => {
    const code = "@startuml\nAlice -> Bob: hi\n@enduml";

    expect(buildPlantUmlUrl(code)).toBe(
      "https://www.plantuml.com/plantuml/svg/SoWkIImgAStDuNBCoKnELT2rKt3AJx9IoCZaSaZDIm5A0000",
    );
  });

  test("encodes the kitchen sink activity diagram snippet", () => {
    const code = `@startuml
start
:Open the document;
:Paste the kitchen sink markdown;
if (Switch to write mode?) then (yes)
  :Preview Mermaid;
  :Preview PlantUML;
else (no)
  :Stay in raw mode;
endif
:Switch to read mode;
:Verify rendered output;
stop
@enduml`;

    expect(buildPlantUmlUrl(code)).toBe(
      "https://www.plantuml.com/plantuml/svg/JO_12eCm44Jl-OezwY_4G_s0IWLfxy6ik6WsibaR_Fj6ARItvStC3jCcTQ9xMCrr6FlOa45d11_7FI1hOsplak855z9nBeP4l41milYOkJ4qGJNaKmEDa8MAFKIFj_fCCLG7fje0s5xmJPYXGmcEVFFF-jMnFhjxOt1D21N7ApAeEu0OnENhPv7PqsJihr3G-QzcNoWq7GMnHq4FSTTjBoEInisqXPQj7m00",
    );
  });

  test("supports png output", () => {
    const code = "@startuml\nAlice -> Bob: hi\n@enduml";

    expect(buildPlantUmlUrl(code, "png")).toBe(
      "https://www.plantuml.com/plantuml/png/SoWkIImgAStDuNBCoKnELT2rKt3AJx9IoCZaSaZDIm5A0000",
    );
  });
});
