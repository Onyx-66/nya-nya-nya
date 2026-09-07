import type { ComponentType, SVGProps } from "react";
import * as Outline from "@heroicons/react/24/outline";
import * as Solid from "@heroicons/react/24/solid";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "color"> & {
  size?: number | string;
  weight?: string;
  color?: string;
  mirrored?: boolean;
};
export type Icon = ComponentType<IconProps>;

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

type IconOptions = {
  transform?: string;
};

function bridge(outlineIcon: HeroIcon, solidIcon: HeroIcon = outlineIcon, options: IconOptions = {}): Icon {
  return function HeroIconBridge({ size = 24, weight, color, mirrored = false, style, ...props }: IconProps) {
    const IconComponent = weight === "fill" ? solidIcon : outlineIcon;
    const transform = [options.transform, mirrored ? "scaleX(-1)" : ""].filter(Boolean).join(" ") || undefined;
    return (
      <IconComponent
        {...props}
        width={size}
        height={size}
        color={color}
        style={{ ...style, transform }}
      />
    );
  };
}

const outline = (name: keyof typeof Outline): HeroIcon => Outline[name] as HeroIcon;
const solid = (name: keyof typeof Solid): HeroIcon => Solid[name] as HeroIcon;

export const ArrowClockwise = bridge(outline("ArrowPathIcon"), solid("ArrowPathIcon"));
export const ArrowCounterClockwise = bridge(outline("ArrowPathIcon"), solid("ArrowPathIcon"), { transform: "rotate(180deg)" });
export const ArrowDown = bridge(outline("ArrowDownIcon"), solid("ArrowDownIcon"));
export const ArrowFatDown = bridge(outline("ArrowDownIcon"), solid("ArrowDownIcon"));
export const ArrowFatUp = bridge(outline("ArrowUpIcon"), solid("ArrowUpIcon"));
export const ArrowLeft = bridge(outline("ArrowLeftIcon"), solid("ArrowLeftIcon"));
export const ArrowRight = bridge(outline("ArrowRightIcon"), solid("ArrowRightIcon"));
export const ArrowsDownUp = bridge(outline("ArrowsUpDownIcon"), solid("ArrowsUpDownIcon"));
export const ArrowsHorizontal = bridge(outline("ArrowsRightLeftIcon"), solid("ArrowsRightLeftIcon"));
export const ArrowsOut = bridge(outline("ArrowsPointingOutIcon"), solid("ArrowsPointingOutIcon"));
export const ArrowSquareOut = bridge(outline("ArrowTopRightOnSquareIcon"), solid("ArrowTopRightOnSquareIcon"));
export const ArrowUp = bridge(outline("ArrowUpIcon"), solid("ArrowUpIcon"));
export const ArrowUpRight = bridge(outline("ArrowUpRightIcon"), solid("ArrowUpRightIcon"));
export const Bell = bridge(outline("BellIcon"), solid("BellIcon"));
export const BookOpenText = bridge(outline("BookOpenIcon"), solid("BookOpenIcon"));
export const Books = bridge(outline("RectangleStackIcon"), solid("RectangleStackIcon"));
export const CalendarBlank = bridge(outline("CalendarDaysIcon"), solid("CalendarDaysIcon"));
export const CalendarPlus = bridge(outline("CalendarDaysIcon"), solid("CalendarDaysIcon"));
export const Camera = bridge(outline("CameraIcon"), solid("CameraIcon"));
export const CaretDown = bridge(outline("ChevronDownIcon"), solid("ChevronDownIcon"));
export const CaretLeft = bridge(outline("ChevronLeftIcon"), solid("ChevronLeftIcon"));
export const CaretRight = bridge(outline("ChevronRightIcon"), solid("ChevronRightIcon"));
export const CaretUp = bridge(outline("ChevronUpIcon"), solid("ChevronUpIcon"));
export const ChartLineUp = bridge(outline("ChartBarIcon"), solid("ChartBarIcon"));
export const ChatCenteredDots = bridge(outline("ChatBubbleBottomCenterTextIcon"), solid("ChatBubbleBottomCenterTextIcon"));
export const ChatCircle = bridge(outline("ChatBubbleOvalLeftEllipsisIcon"), solid("ChatBubbleOvalLeftEllipsisIcon"));
export const Check = bridge(outline("CheckIcon"), solid("CheckIcon"));
export const CheckCircle = bridge(outline("CheckCircleIcon"), solid("CheckCircleIcon"));
export const ClipboardText = bridge(outline("ClipboardDocumentListIcon"), solid("ClipboardDocumentListIcon"));
export const Clock = bridge(outline("ClockIcon"), solid("ClockIcon"));
export const ClockCounterClockwise = bridge(outline("ArrowPathRoundedSquareIcon"), solid("ArrowPathRoundedSquareIcon"));
export const CloudArrowUp = bridge(outline("CloudArrowUpIcon"), solid("CloudArrowUpIcon"));
export const Coins = bridge(outline("CircleStackIcon"), solid("CircleStackIcon"));
export const Compass = bridge(outline("GlobeAltIcon"), solid("GlobeAltIcon"));
export const Copy = bridge(outline("DocumentDuplicateIcon"), solid("DocumentDuplicateIcon"));
export const CreditCard = bridge(outline("CreditCardIcon"), solid("CreditCardIcon"));
export const Crown = bridge(outline("TrophyIcon"), solid("TrophyIcon"));
export const CrownSimple = bridge(outline("TrophyIcon"), solid("TrophyIcon"));
export const Database = bridge(outline("ServerStackIcon"), solid("ServerStackIcon"));
export const Desktop = bridge(outline("ComputerDesktopIcon"), solid("ComputerDesktopIcon"));
export const DeviceMobile = bridge(outline("DevicePhoneMobileIcon"), solid("DevicePhoneMobileIcon"));
export const DotsSixVertical = bridge(outline("EllipsisVerticalIcon"), solid("EllipsisVerticalIcon"));
export const DotsThree = bridge(outline("EllipsisHorizontalIcon"), solid("EllipsisHorizontalIcon"));
export const DownloadSimple = bridge(outline("ArrowDownTrayIcon"), solid("ArrowDownTrayIcon"));
export const Eraser = bridge(outline("BackspaceIcon"), solid("BackspaceIcon"));
export const Eye = bridge(outline("EyeIcon"), solid("EyeIcon"));
export const EyeSlash = bridge(outline("EyeSlashIcon"), solid("EyeSlashIcon"));
export const FileImage = bridge(outline("PhotoIcon"), solid("PhotoIcon"));
export const FileText = bridge(outline("DocumentTextIcon"), solid("DocumentTextIcon"));
export const FilmStrip = bridge(outline("FilmIcon"), solid("FilmIcon"));
export const Fingerprint = bridge(outline("FingerPrintIcon"), solid("FingerPrintIcon"));
export const Fire = bridge(outline("FireIcon"), solid("FireIcon"));
export const FloppyDisk = bridge(outline("ArrowDownTrayIcon"), solid("ArrowDownTrayIcon"));
export const FolderOpen = bridge(outline("FolderOpenIcon"), solid("FolderOpenIcon"));
export const Gauge = bridge(outline("ChartBarIcon"), solid("ChartBarIcon"));
export const GearSix = bridge(outline("Cog6ToothIcon"), solid("Cog6ToothIcon"));
export const Gif = bridge(outline("GifIcon"), solid("GifIcon"));
export const Gift = bridge(outline("GiftIcon"), solid("GiftIcon"));
export const GridFour = bridge(outline("Squares2X2Icon"), solid("Squares2X2Icon"));
export const HardDrives = bridge(outline("ServerStackIcon"), solid("ServerStackIcon"));
export const HashStraight = bridge(outline("HashtagIcon"), solid("HashtagIcon"));
export const Heart = bridge(outline("HeartIcon"), solid("HeartIcon"));
export const House = bridge(outline("HomeIcon"), solid("HomeIcon"));
export const IdentificationCard = bridge(outline("IdentificationIcon"), solid("IdentificationIcon"));
export const Image = bridge(outline("PhotoIcon"), solid("PhotoIcon"));
export const Images = bridge(outline("RectangleGroupIcon"), solid("RectangleGroupIcon"));
export const ImageSquare = bridge(outline("PhotoIcon"), solid("PhotoIcon"));
export const Info = bridge(outline("InformationCircleIcon"), solid("InformationCircleIcon"));
export const Key = bridge(outline("KeyIcon"), solid("KeyIcon"));
export const Keyboard = bridge(outline("CommandLineIcon"), solid("CommandLineIcon"));
export const Lifebuoy = bridge(outline("LifebuoyIcon"), solid("LifebuoyIcon"));
export const LinkSimple = bridge(outline("LinkIcon"), solid("LinkIcon"));
export const List = bridge(outline("ListBulletIcon"), solid("ListBulletIcon"));
export const ListBullets = bridge(outline("ListBulletIcon"), solid("ListBulletIcon"));
export const ListChecks = bridge(outline("ClipboardDocumentCheckIcon"), solid("ClipboardDocumentCheckIcon"));
export const LockKey = bridge(outline("LockClosedIcon"), solid("LockClosedIcon"));
export const LockSimple = bridge(outline("LockClosedIcon"), solid("LockClosedIcon"));
export const MagnifyingGlass = bridge(outline("MagnifyingGlassIcon"), solid("MagnifyingGlassIcon"));
export const Medal = bridge(outline("TrophyIcon"), solid("TrophyIcon"));
export const Megaphone = bridge(outline("MegaphoneIcon"), solid("MegaphoneIcon"));
export const MegaphoneSimple = bridge(outline("MegaphoneIcon"), solid("MegaphoneIcon"));
export const Minus = bridge(outline("MinusIcon"), solid("MinusIcon"));
export const Moon = bridge(outline("MoonIcon"), solid("MoonIcon"));
export const NavigationArrow = bridge(outline("CursorArrowRaysIcon"), solid("CursorArrowRaysIcon"));
export const NotePencil = bridge(outline("PencilSquareIcon"), solid("PencilSquareIcon"));
export const PaintBrush = bridge(outline("PaintBrushIcon"), solid("PaintBrushIcon"));
export const Palette = bridge(outline("SwatchIcon"), solid("SwatchIcon"));
export const PaperPlaneTilt = bridge(outline("PaperAirplaneIcon"), solid("PaperAirplaneIcon"));
export const PencilSimple = bridge(outline("PencilIcon"), solid("PencilIcon"));
export const Play = bridge(outline("PlayIcon"), solid("PlayIcon"));
export const PlugsConnected = bridge(outline("LinkIcon"), solid("LinkIcon"));
export const Plus = bridge(outline("PlusIcon"), solid("PlusIcon"));
export const Power = bridge(outline("PowerIcon"), solid("PowerIcon"));
export const Pulse = bridge(outline("SignalIcon"), solid("SignalIcon"));
export const PushPin = bridge(outline("BookmarkIcon"), solid("BookmarkIcon"));
export const Rows = bridge(outline("QueueListIcon"), solid("QueueListIcon"));
export const ShieldCheck = bridge(outline("ShieldCheckIcon"), solid("ShieldCheckIcon"));
export const ShieldWarning = bridge(outline("ShieldExclamationIcon"), solid("ShieldExclamationIcon"));
export const SidebarSimple = bridge(outline("ViewColumnsIcon"), solid("ViewColumnsIcon"));
export const SignIn = bridge(outline("ArrowLeftOnRectangleIcon"), solid("ArrowLeftOnRectangleIcon"));
export const SignOut = bridge(outline("ArrowRightOnRectangleIcon"), solid("ArrowRightOnRectangleIcon"));
export const SlidersHorizontal = bridge(outline("AdjustmentsHorizontalIcon"), solid("AdjustmentsHorizontalIcon"));
export const Smiley = bridge(outline("FaceSmileIcon"), solid("FaceSmileIcon"));
export const Sparkle = bridge(outline("SparklesIcon"), solid("SparklesIcon"));
export const SquaresFour = bridge(outline("Squares2X2Icon"), solid("Squares2X2Icon"));
export const Star = bridge(outline("StarIcon"), solid("StarIcon"));
export const Storefront = bridge(outline("BuildingStorefrontIcon"), solid("BuildingStorefrontIcon"));
export const Tag = bridge(outline("TagIcon"), solid("TagIcon"));
export const TagSimple = bridge(outline("TagIcon"), solid("TagIcon"));
export const TextB = bridge(outline("BoldIcon"), solid("BoldIcon"));
export const TextItalic = bridge(outline("ItalicIcon"), solid("ItalicIcon"));
export const ThumbsUp = bridge(outline("HandThumbUpIcon"), solid("HandThumbUpIcon"));
export const Ticket = bridge(outline("TicketIcon"), solid("TicketIcon"));
export const Timer = bridge(outline("ClockIcon"), solid("ClockIcon"));
export const Translate = bridge(outline("LanguageIcon"), solid("LanguageIcon"));
export const Trash = bridge(outline("TrashIcon"), solid("TrashIcon"));
export const Tray = bridge(outline("InboxIcon"), solid("InboxIcon"));
export const Trophy = bridge(outline("TrophyIcon"), solid("TrophyIcon"));
export const UploadSimple = bridge(outline("ArrowUpTrayIcon"), solid("ArrowUpTrayIcon"));
export const UserCircle = bridge(outline("UserCircleIcon"), solid("UserCircleIcon"));
export const UserGear = bridge(outline("UserIcon"), solid("UserIcon"));
export const UserMinus = bridge(outline("UserMinusIcon"), solid("UserMinusIcon"));
export const UserPlus = bridge(outline("UserPlusIcon"), solid("UserPlusIcon"));
export const UsersThree = bridge(outline("UserGroupIcon"), solid("UserGroupIcon"));
export const UserSwitch = bridge(outline("ArrowsRightLeftIcon"), solid("ArrowsRightLeftIcon"));
export const Wallet = bridge(outline("WalletIcon"), solid("WalletIcon"));
export const Warning = bridge(outline("ExclamationTriangleIcon"), solid("ExclamationTriangleIcon"));
export const WarningCircle = bridge(outline("ExclamationCircleIcon"), solid("ExclamationCircleIcon"));
export const X = bridge(outline("XMarkIcon"), solid("XMarkIcon"));
export const XCircle = bridge(outline("XCircleIcon"), solid("XCircleIcon"));
