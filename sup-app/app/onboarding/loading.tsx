import React from "react";
import { View, Image, StyleSheet, Dimensions } from "react-native";

const { width: W } = Dimensions.get("window");

export default function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/images/mascot.png")}
        style={styles.mascot}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#AB99FA",
    alignItems: "center",
    justifyContent: "center",
  },
  mascot: {
    width: W * 0.65,
    height: W * 0.65,
  },
});
