import PressFeedback from "@/src/components/ui/PressFeedback";
/**
 * BrandAlert.tsx
 *
 * On-brand replacement for React Native's native Alert.alert — a purple,
 * app-styled confirm/notice dialog. Native Alert dialogs can't be themed,
 * so anywhere the alert's look should match the app (s'pot placement check,
 * s'pot disconnected notices) uses this controlled modal instead.
 */

import React from "react";
import {
  Modal, View, Text, StyleSheet, TouchableWithoutFeedback,
} from "react-native";

export interface BrandAlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

export function BrandAlert({
  visible,
  title,
  message,
  buttons = [{ text: "ok" }],
  onRequestClose,
  dismissable = true,
}: {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: BrandAlertButton[];
  onRequestClose: () => void;
  dismissable?: boolean;
}) {
  const handlePress = (btn: BrandAlertButton) => {
    onRequestClose();
    btn.onPress?.();
  };

  const handleBackdrop = () => {
    if (dismissable) onRequestClose();
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={handleBackdrop}>
      <TouchableWithoutFeedback onPress={handleBackdrop}>
        <View style={s.overlay}>
          <TouchableWithoutFeedback>
            <View style={s.sheet}>
              <Text style={s.title}>{title}</Text>
              {message ? <Text style={s.body}>{message}</Text> : null}

              <View style={[s.buttonRow, buttons.length > 2 && s.buttonCol]}>
                {buttons.map((btn, i) => {
                  const solid = btn.style === "default" || btn.style === undefined;
                  return (
                    <PressFeedback
                      key={`${btn.text}-${i}`}
                      style={[s.btn, solid ? s.btnPrimary : s.btnGhost]}
                      onPress={() => handlePress(btn)}
                    >
                      <Text
                        style={[
                          s.btnText,
                          solid && s.btnTextPrimary,
                          btn.style === "cancel" && s.btnTextGhost,
                          btn.style === "destructive" && s.btnTextDestructive,
                        ]}
                      >
                        {btn.text}
                      </Text>
                    </PressFeedback>
                  );
                })}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const PURPLE = "#5222AE";
const PURPLE_SOFT = "#EDE8FF";

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  sheet: {
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 26,
    width: "100%",
    borderWidth: 2,
    borderColor: PURPLE,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 19,
    fontFamily: "Agrandir-GrandHeavy",
    color: PURPLE,
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    fontFamily: "Agrandir-Regular",
    color: "#333",
    lineHeight: 21,
    textAlign: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  buttonCol: {
    flexDirection: "column",
  },
  btn: {
    flex: 1,
    borderRadius: 30,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: PURPLE,
  },
  btnGhost: {
    backgroundColor: PURPLE_SOFT,
  },
  btnText: {
    fontSize: 14,
    fontFamily: "Agrandir-GrandHeavy",
    textAlign: "center",
  },
  btnTextPrimary: {
    color: "#fff",
  },
  btnTextGhost: {
    color: PURPLE,
  },
  btnTextDestructive: {
    color: "#D32F2F",
  },
});
