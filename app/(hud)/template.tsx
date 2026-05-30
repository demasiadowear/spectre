"use client";

import { motion } from "framer-motion";

/**
 * Re-mounts on every navigation inside the HUD, so each module fades/rises
 * in on entry. A template (not a layout) is what gives us the per-route
 * mount needed for the transition.
 */
export default function HudTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
