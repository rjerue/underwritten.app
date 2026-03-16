import { describe, expect, test } from "vite-plus/test";

import { buildPlantUmlUrl } from "./plantuml";

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
});
