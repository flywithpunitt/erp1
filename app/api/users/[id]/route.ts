import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import User from "@/lib/models/User";
import { getAuthUser } from "@/lib/auth";

type RouteContext = { params: { id: string } | Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authUser = await getAuthUser(request);

    if (!authUser) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (authUser.role !== "ADMIN") {
      return NextResponse.json({ message: "Admin access required" }, { status: 403 });
    }

    const params = await Promise.resolve(context.params);
    const { id } = params;

    await connectDB();

    const userToDelete = await User.findById(id).select("role");
    if (!userToDelete) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    if (userToDelete.role !== "MANAGER") {
      return NextResponse.json(
        { message: "Only manager accounts can be deleted" },
        { status: 403 }
      );
    }

    await User.deleteOne({ _id: id });

    return NextResponse.json({ message: "Manager deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("Delete user error:", error);
    return NextResponse.json({ message: "Failed to delete user" }, { status: 500 });
  }
}

