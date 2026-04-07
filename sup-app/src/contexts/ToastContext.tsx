import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { colours } from "../../theme/colours";

type ToastTone = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const TOAST_VISIBLE_MS = 2200;

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ToastEntry[]>([]);
  const [activeToast, setActiveToast] = useState<ToastEntry | null>(null);
  const nextToastIdRef = useRef(1);
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateAnim = useRef(new Animated.Value(-16)).current;

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    const nextToast: ToastEntry = {
      id: nextToastIdRef.current,
      message: trimmedMessage,
      tone,
    };

    nextToastIdRef.current += 1;
    setQueue((prev) => [...prev, nextToast]);
  }, []);

  useEffect(() => {
    if (activeToast || queue.length === 0) {
      return;
    }

    const [nextToast, ...rest] = queue;
    setActiveToast(nextToast);
    setQueue(rest);
  }, [activeToast, queue]);

  useEffect(() => {
    if (!activeToast) {
      return;
    }

    opacityAnim.setValue(0);
    translateAnim.setValue(-16);

    const animateIn = Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const animateOut = Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateAnim, {
        toValue: -16,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    let dismissTimer: ReturnType<typeof setTimeout> | undefined;

    animateIn.start(() => {
      dismissTimer = setTimeout(() => {
        animateOut.start(() => {
          setActiveToast(null);
        });
      }, TOAST_VISIBLE_MS);
    });

    return () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
      }
      animateIn.stop();
      animateOut.stop();
    };
  }, [activeToast, opacityAnim, translateAnim]);

  const toneStyle = useMemo(() => {
    if (!activeToast) return styles.infoToast;
    if (activeToast.tone === "success") return styles.successToast;
    if (activeToast.tone === "error") return styles.errorToast;
    return styles.infoToast;
  }, [activeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      <View style={styles.root}>
        {children}
        {activeToast ? (
          <View pointerEvents="none" style={styles.overlay}>
            <Animated.View
              style={[
                styles.toast,
                toneStyle,
                {
                  opacity: opacityAnim,
                  transform: [{ translateY: translateAnim }],
                },
              ]}
            >
              <Text style={styles.toastText}>{activeToast.message}</Text>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 58,
    alignItems: "center",
    paddingHorizontal: 20,
  },
  toast: {
    minHeight: 44,
    maxWidth: "100%",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
  infoToast: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E8E8F2",
  },
  successToast: {
    backgroundColor: colours.primarySoft,
    borderColor: colours.primary,
  },
  errorToast: {
    backgroundColor: "#FFF1F1",
    borderColor: "#F08A8A",
  },
  toastText: {
    color: "#2D2D36",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
