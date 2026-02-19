import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useState } from 'react';

const ItemTypes = {
    WIDGET: 'widget',
};

interface WidgetProps {
    id: string;
    left: number;
    top: number;
    children: React.ReactNode;
}

function Widget({ id, left, top, children }: WidgetProps) {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: ItemTypes.WIDGET,
        item: { id, left, top },
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
        }),
    }), [id, left, top]);

    if (isDragging) {
        return <div ref={drag as any} />;
    }

    return (
        <div
            ref={drag as any}
            style={{ left, top }}
            className="absolute bg-gray-200 p-2 rounded cursor-move"
        >
            {children}
        </div>
    );
}

interface CanvasProps {
    children: React.ReactNode;
    moveWidget: (id: string, left: number, top: number) => void;
    resolution: { width: number; height: number };
}

function Canvas({ children, moveWidget, resolution }: CanvasProps) {
    const [, drop] = useDrop(() => ({
        accept: ItemTypes.WIDGET,
        drop(item: { id: string, left: number, top: number }, monitor) {
            const delta = monitor.getDifferenceFromInitialOffset();
            if (!delta) return;
            let left = Math.round(item.left + delta.x);
            let top = Math.round(item.top + delta.y);

            // prevent dragging outside of canvas
            left = Math.max(0, Math.min(left, resolution.width - 100)); // assuming widget width of 100
            top = Math.max(0, Math.min(top, resolution.height - 50)); // assuming widget height of 50
            
            moveWidget(item.id, left, top);
            return undefined;
        },
    }), [moveWidget]);

    return (
        <div
            ref={drop as any}
            className="relative w-full h-full bg-white border-2 border-dashed border-gray-300"
        >
            {children}
        </div>
    );
}

interface PreviewModalProps {
    onClose: () => void;
    widgets: { [key: string]: { top: number; left: number; content: string } };
    resolution: { width: number; height: number };
}

function PreviewModal({ onClose, widgets, resolution }: PreviewModalProps) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl relative border border-stone-200">
                <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-stone-900 p-1 rounded-full hover:bg-stone-100 transition-colors">
                    <span className="sr-only">Close</span>
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <div className="p-6 border-b border-stone-100">
                    <h2 className="text-2xl font-bold text-black mb-1">Layout Preview</h2>
                    <p className="text-sm text-black italic">This is a preview of your configured layout.</p>
                </div>
                <div className="p-6 overflow-auto bg-stone-50/30 rounded-b-lg">
                    <div
                        style={{
                            width: resolution.width,
                            height: resolution.height,
                        }}
                        className="relative bg-white border-2 border-dashed border-gray-300 mx-auto"
                    >
                        {Object.keys(widgets).map((key) => {
                            const { left, top, content } = widgets[key];
                            return (
                                <div
                                    key={key}
                                    style={{ left, top }}
                                    className="absolute bg-gray-200 p-2 rounded"
                                >
                                    {content}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface WidgetState {
    [key: string]: {
        top: number;
        left: number;
        content: string;
    };
}

export function Layout() {
    const [widgets, setWidgets] = useState<WidgetState>({
        a: { top: 20, left: 80, content: 'Widget A' },
    });

    const [resolution, setResolution] = useState({ width: 800, height: 600 });
    const [showPreview, setShowPreview] = useState(false);

    const moveWidget = (id: string, left: number, top: number) => {
        setWidgets((prevWidgets) => ({
            ...prevWidgets,
            [id]: { ...prevWidgets[id], left, top },
        }));
    };

    return (
        <DndProvider backend={HTML5Backend}>
            <div className="flex flex-col h-full">
                <div className="mb-4">
                    <h1 className="text-2xl font-bold">Layout Editor</h1>
                    <p className="text-sm text-gray-500">
                        Drag and drop widgets to configure the display layout.
                    </p>
                </div>
                <div className="flex-grow flex">
                    <div className="w-1/4 pr-4">
                        <h2 className="text-lg font-semibold mb-2">Widgets</h2>
                        {/* Add a list of available widgets here */}
                        <div className="space-y-2">
                            <div className="p-2 bg-gray-100 rounded">Widget 1</div>
                            <div className="p-2 bg-gray-100 rounded">Widget 2</div>
                            <div className="p-2 bg-gray-100 rounded">Widget 3</div>
                        </div>
                    </div>
                    <div className="w-3/4">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <label htmlFor="resolution" className="mr-2">
                                    Resolution:
                                </label>
                                <select
                                    id="resolution"
                                    value={`${resolution.width}x${resolution.height}`}
                                    onChange={(e) => {
                                        const [width, height] = e.target.value.split('x').map(Number);
                                        setResolution({ width, height });
                                    }}
                                >
                                    <option value="800x600">800x600</option>
                                    <option value="1024x768">1024x768</option>
                                </select>
                            </div>
                            <div className="flex items-center">
                                <span className="text-sm text-gray-500 mr-4">Unsaved Changes</span>
                                <button className="bg-blue-500 text-white px-4 py-2 rounded">
                                    Save
                               </button>
                                <button
                                    onClick={() => setShowPreview(true)}
                                    className="ml-2 bg-gray-500 text-white px-4 py-2 rounded"
                                >
                                    Preview
                                </button>
                            </div>
                        </div>
                        <div
                            style={{
                                width: resolution.width,
                                height: resolution.height,
                            }}
                            className="overflow-auto"
                        >
                            <Canvas resolution={resolution} moveWidget={moveWidget}>
                                {Object.keys(widgets).map((key) => {
                                    const { left, top, content } = widgets[key];
                                    return (
                                        <Widget key={key} id={key} left={left} top={top}>
                                            {content}
                                        </Widget>
                                    );
                                })}
                            </Canvas>
                        </div>
                    </div>
                </div>
                {showPreview && (
                    <PreviewModal
                        onClose={() => setShowPreview(false)}
                        widgets={widgets}
                        resolution={resolution}
                    />
                )}
            </div>
        </DndProvider>
    );
}