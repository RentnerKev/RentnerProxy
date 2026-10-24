import { CustomSelect } from '@rentnerkev/select/select'
import type { TableFilterOption, TableFilterSelectProps } from '../Types/table.types.ts'

export default function TableFilterSelect({
    options,
    renderOption,
    ...props
}: TableFilterSelectProps) {
    const renderContent = (option: TableFilterOption) =>
        option.value === ''
            ? option.label
            : renderOption
              ? renderOption(option)
              : (options.find((candidate) => candidate.value === option.value)?.content ??
                option.label)

    return (
        <CustomSelect
            {...props}
            options={options}
            renderOption={renderContent}
            renderValue={(selected) => (selected[0] ? renderContent(selected[0]) : null)}
        />
    )
}
