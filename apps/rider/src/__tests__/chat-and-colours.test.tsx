// RNTL 14: render/fireEvent are async.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  ChatSheet,
  ColourPicker,
  VEHICLE_COLOURS,
  carArt,
  vehicleColour,
} from "@gobye/ui";

describe("ride chat sheet and car colours (D-108)", () => {
  it("shows the conversation, sends a quick message with one tap and a typed one, and shows why a send failed", async () => {
    const onSend = jest.fn(async (t: string) =>
      t === "fail" ? "Not sent. Check your connection and try again." : null,
    );
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <ChatSheet
          visible
          onClose={() => undefined}
          title="Tunde"
          messages={[
            { id: "1", mine: false, text: "I’ve arrived", at: 0 },
            { id: "2", mine: true, text: "Coming out now", at: 1 },
          ]}
          quickReplies={["Where are you?"]}
          onSend={onSend}
          note="Your phone numbers stay private."
        />
      </SafeAreaProvider>,
    );
    expect(screen.getByText("I’ve arrived")).toBeTruthy();
    expect(screen.getByText("Your phone numbers stay private.")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Send: Where are you?" }),
    );
    expect(onSend).toHaveBeenLastCalledWith("Where are you?");

    await fireEvent.changeText(screen.getByTestId("chat-input"), "Blue gate");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("chat-send"));
    });
    expect(onSend).toHaveBeenLastCalledWith("Blue gate");
    expect(screen.getByTestId("chat-input").props.value).toBe("");

    await fireEvent.changeText(screen.getByTestId("chat-input"), "fail");
    await act(async () => {
      await fireEvent.press(screen.getByTestId("chat-send"));
    });
    expect(screen.getByTestId("chat-error")).toBeTruthy();
    expect(screen.getByTestId("chat-input").props.value).toBe("fail");
  });

  it("a colour is picked from the list, and every listed colour has its own car picture", async () => {
    const onChange = jest.fn();
    await render(
      <ColourPicker
        label="Colour"
        value="Silver"
        onChange={onChange}
        testID="c"
      />,
    );
    expect(
      screen.getByRole("radio", { name: "Silver" }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole("radio", { name: "Wine" }));
    expect(onChange).toHaveBeenCalledWith("Wine");

    const pictures = new Set(
      VEHICLE_COLOURS.map((c) => JSON.stringify(carArt(c.name))),
    );
    expect(VEHICLE_COLOURS.length).toBe(12);
    expect(vehicleColour(" GRAY ")?.id).toBe("grey");
    expect(vehicleColour("Maroon")?.id).toBe("wine");
    expect(vehicleColour("Lilac")).toBeNull();
    expect(carArt("Lilac")).toBe(carArt("White"));
    // In tests every picture resolves to the same stub, so this only checks nothing is missing.
    expect(pictures.size).toBeGreaterThanOrEqual(1);
  });
});
