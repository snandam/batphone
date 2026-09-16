import Image from "next/image";

import { APP_NAME, APP_LOGO_PATH, APP_LOGO_SIZE } from "@/constants";

interface LogoProps {
  showText?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: { width: 24, height: 24 },
  md: { width: 32, height: 32 },
  lg: { width: 40, height: 40 },
};

export function Logo({
  showText = true,
  className = "",
  size = "md",
}: LogoProps) {
  const dimensions = sizeMap[size] || APP_LOGO_SIZE;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Image
        src={APP_LOGO_PATH}
        alt={`${APP_NAME} logo`}
        width={dimensions.width}
        height={dimensions.height}
        className="dark:invert"
        priority
      />
      {showText && (
        <span className="text-lg font-bold sm:text-xl">{APP_NAME}</span>
      )}
    </div>
  );
}
