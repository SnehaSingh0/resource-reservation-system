export type Resource = {
  id: string;
  name: string;
  type: string;
  description: string;
  location: string;
  availableDays: string[];
  startTime: string;
  endTime: string;
  weeklyAvailability: Record<number, { startTime: string; endTime: string } | null>;
  status: "Active" | "Inactive";
};

export type Reservation = {
  id: string;
  user: string;
  resource: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "Confirmed" | "Pending" | "Cancelled";
};

export const demoResources: Resource[] = [
  {
    id: "resource-1",
    name: "Meeting Room 1",
    type: "Room",
    description: "Small meeting room with a display and whiteboard.",
    location: "2nd Floor",
    availableDays: ["Mon", "Tue", "Wed", "Fri"],
    startTime: "09:00",
    endTime: "18:00",
    weeklyAvailability: {
      0: null,
      1: { startTime: "09:00", endTime: "18:00" },
      2: { startTime: "09:00", endTime: "18:00" },
      3: { startTime: "09:00", endTime: "13:00" },
      4: null,
      5: { startTime: "10:00", endTime: "16:00" },
      6: null,
    },
    status: "Active",
  },
  {
    id: "resource-2",
    name: "Meeting Room 2",
    type: "Room",
    description: "Meeting room for collaborative sessions.",
    location: "3rd Floor",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    startTime: "09:00",
    endTime: "17:00",
    weeklyAvailability: {
      0: null,
      1: { startTime: "09:00", endTime: "17:00" },
      2: { startTime: "09:00", endTime: "17:00" },
      3: { startTime: "09:00", endTime: "17:00" },
      4: { startTime: "09:00", endTime: "17:00" },
      5: { startTime: "09:00", endTime: "17:00" },
      6: null,
    },
    status: "Active",
  },
  {
    id: "resource-3",
    name: "Projector 1",
    type: "Equipment",
    description: "Portable HD projector for presentations.",
    location: "IT Storage",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    startTime: "08:00",
    endTime: "18:00",
    weeklyAvailability: {
      0: null,
      1: { startTime: "08:00", endTime: "18:00" },
      2: { startTime: "08:00", endTime: "18:00" },
      3: { startTime: "08:00", endTime: "18:00" },
      4: { startTime: "08:00", endTime: "18:00" },
      5: { startTime: "08:00", endTime: "18:00" },
      6: null,
    },
    status: "Active",
  },
  {
    id: "resource-4",
    name: "Training Room",
    type: "Room",
    description: "Training space with flexible seating.",
    location: "1st Floor",
    availableDays: ["Mon", "Tue", "Wed", "Thu"],
    startTime: "09:00",
    endTime: "16:00",
    weeklyAvailability: {
      0: null,
      1: { startTime: "09:00", endTime: "16:00" },
      2: { startTime: "09:00", endTime: "16:00" },
      3: { startTime: "09:00", endTime: "16:00" },
      4: { startTime: "09:00", endTime: "16:00" },
      5: null,
      6: null,
    },
    status: "Inactive",
  },
  {
    id: "resource-5",
    name: "Laptop 2",
    type: "Equipment",
    description: "Portable laptop for temporary work use.",
    location: "IT Storage",
    availableDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    startTime: "08:00",
    endTime: "18:00",
    weeklyAvailability: {
      0: null,
      1: { startTime: "08:00", endTime: "18:00" },
      2: { startTime: "08:00", endTime: "18:00" },
      3: { startTime: "08:00", endTime: "18:00" },
      4: { startTime: "08:00", endTime: "18:00" },
      5: { startTime: "08:00", endTime: "18:00" },
      6: null,
    },
    status: "Active",
  },
];

export const demoReservations: Reservation[] = [
  {
    id: "RS-1048",
    user: "Sarah Chen",
    resource: "Meeting Room 1",
    date: "2026-10-07",
    startTime: "10:00",
    endTime: "12:00",
    status: "Confirmed",
  },
  {
    id: "RS-1047",
    user: "Rahul Patel",
    resource: "Laptop 2",
    date: "2026-10-08",
    startTime: "14:00",
    endTime: "16:00",
    status: "Confirmed",
  },
  {
    id: "RS-1046",
    user: "Priya Shah",
    resource: "Projector 1",
    date: "2026-10-09",
    startTime: "11:00",
    endTime: "13:00",
    status: "Pending",
  },
  {
    id: "RS-1045",
    user: "Amit Kumar",
    resource: "Meeting Room 2",
    date: "2026-10-10",
    startTime: "09:00",
    endTime: "10:00",
    status: "Confirmed",
  },
];

export const demoAdmins = [
  { id: "admin-1", name: "Jordan Davis", email: "jordan.davis@example.com" },
  { id: "admin-2", name: "Taylor Morgan", email: "taylor.morgan@example.com" },
];
